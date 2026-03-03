"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Square, Move } from "chess.js";
import { Chessboard } from "react-chessboard";

type Mode = "cpu" | "friend";
type Difficulty = "easy" | "medium" | "hard";
type Color = "w" | "b";

type PendingPromotion = {
  from: Square;
  to: Square;
  color: Color;
};

type LastMove = { from: Square; to: Square } | null;

type TimeControl = "open" | "blitz" | "rapid";

type Snapshot = {
  fen: string;
  lastMove: LastMove;
  wTimeMs: number;
  bTimeMs: number;
  timeControl: TimeControl;
  gameOverText: string;
  statusText: string;
};

type SavedStateV1 = {
  v: 1;
  fen: string;
  mode: Mode;
  difficulty: Difficulty;
  playerColor: Color;
  timeControl: TimeControl;
  wTimeMs: number;
  bTimeMs: number;
  lastMove: LastMove;
  scores: { w: number; b: number; d: number };
};

const STORAGE_KEY = "paperlink_play_chess_v1";

function isSquare(v: string): v is Square {
  return /^[a-h][1-8]$/.test(v);
}

function pieceValue(pieceType: string): number {
  switch (pieceType) {
    case "p":
      return 1;
    case "n":
      return 3;
    case "b":
      return 3;
    case "r":
      return 5;
    case "q":
      return 9;
    case "k":
      return 100;
    default:
      return 0;
  }
}

function evalMaterial(chess: Chess): number {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const p of row) {
      if (!p) continue;
      const v = pieceValue(p.type);
      score += p.color === "w" ? v : -v;
    }
  }
  return score;
}

function pickCpuMove(chess: Chess, difficulty: Difficulty): Move | null {
  const moves = chess.moves({ verbose: true }) as unknown as Move[];
  if (!moves.length) return null;

  if (difficulty === "easy") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (difficulty === "medium") {
    const captures = moves.filter((m: any) => m.captured);
    const pool = captures.length ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // hard: 1-ply eval
  let best: Move | null = null;
  let bestScore = chess.turn() === "w" ? -Infinity : Infinity;

  for (const m of moves) {
    const copy = new Chess(chess.fen());
    copy.move(m as any);
    const score = evalMaterial(copy);

    if (chess.turn() === "w") {
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
  }

  return best ?? moves[0];
}

function findKingSquare(chess: Chess, color: Color): Square | null {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (p.type === "k" && p.color === color) {
        const file = "abcdefgh"[c];
        const rank = String(8 - r);
        const sq = `${file}${rank}`;
        return isSquare(sq) ? (sq as Square) : null;
      }
    }
  }
  return null;
}

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function initialTimeMs(tc: TimeControl): number {
  if (tc === "open") return 0;
  if (tc === "blitz") return 5 * 60 * 1000;
  return 10 * 60 * 1000;
}

function pieceLabel(type: string) {
  switch (type) {
    case "p":
      return "P";
    case "n":
      return "N";
    case "b":
      return "B";
    case "r":
      return "R";
    case "q":
      return "Q";
    case "k":
      return "K";
    default:
      return "?";
  }
}

function capturedFromFen(startFen: string, currentFen: string) {
  const countPieces = (fen: string) => {
    const placement = fen.split(" ")[0];
    const counts: Record<string, number> = {};
    for (const ch of placement) {
      if (ch === "/" || (ch >= "1" && ch <= "8")) continue;
      counts[ch] = (counts[ch] ?? 0) + 1;
    }
    return counts;
  };

  const start = countPieces(startFen);
  const cur = countPieces(currentFen);

  const all = ["P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];

  const captured: { whiteCaptured: string[]; blackCaptured: string[] } = {
    whiteCaptured: [],
    blackCaptured: [],
  };

  for (const piece of all) {
    const s = start[piece] ?? 0;
    const c = cur[piece] ?? 0;
    const missing = Math.max(0, s - c);
    if (missing <= 0) continue;

    const isWhitePiece = piece === piece.toUpperCase();
    const label = pieceLabel(piece.toLowerCase());

    if (isWhitePiece) {
      for (let i = 0; i < missing; i++) captured.blackCaptured.push(label);
    } else {
      for (let i = 0; i < missing; i++) captured.whiteCaptured.push(label);
    }
  }

  return captured;
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export default function ChessGame() {
  const chessRef = useRef(new Chess());
  const chess = chessRef.current;

  const startFenRef = useRef<string>(chess.fen());

  const cpuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef<number>(Date.now());

  const [fen, setFen] = useState(chess.fen());

  const [mode, setMode] = useState<Mode>("cpu");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [playerColor, setPlayerColor] = useState<Color>("w");

  const [turnText, setTurnText] = useState("White");
  const [inCheck, setInCheck] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [gameOverText, setGameOverText] = useState("");

  const [scoreWhite, setScoreWhite] = useState(0);
  const [scoreBlack, setScoreBlack] = useState(0);
  const [scoreDraw, setScoreDraw] = useState(0);

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [highlightSquares, setHighlightSquares] = useState<Record<string, React.CSSProperties>>({});

  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [lastMove, setLastMove] = useState<LastMove>(null);

  const [timeControl, setTimeControl] = useState<TimeControl>("open");
  const [wTimeMs, setWTimeMs] = useState<number>(initialTimeMs("open"));
  const [bTimeMs, setBTimeMs] = useState<number>(initialTimeMs("open"));
  const [clockRunning, setClockRunning] = useState(false);

  const [pgnMoves, setPgnMoves] = useState<string[]>([]);

  const [history, setHistory] = useState<Snapshot[]>(() => {
    const start: Snapshot = {
      fen: chess.fen(),
      lastMove: null,
      wTimeMs: initialTimeMs("open"),
      bTimeMs: initialTimeMs("open"),
      timeControl: "open",
      gameOverText: "",
      statusText: "",
    };
    return [start];
  });

  // Friend draw offer state
  const [drawOffer, setDrawOffer] = useState<null | "pending">(null);

  // Share feedback
  const [shareToast, setShareToast] = useState<string>("");

  const turn = chess.turn() as Color;

  const isPlayerTurn = useMemo(() => {
    if (mode === "friend") return true;
    return turn === playerColor;
  }, [mode, turn, playerColor]);

  function cancelCpuTimer() {
    if (cpuTimerRef.current) {
      clearTimeout(cpuTimerRef.current);
      cpuTimerRef.current = null;
    }
  }

  function stopClock() {
    if (clockIntervalRef.current) {
      clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = null;
    }
    setClockRunning(false);
  }

  function startClockIfNeeded() {
    if (timeControl === "open") return;
    if (clockRunning) return;
    if (chess.isGameOver()) return;
    if (gameOverText) return;

    lastTickRef.current = Date.now();

    clockIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;

      if (pendingPromotion) return;
      if (chess.isGameOver()) return;
      if (gameOverText) return;

      const side = chess.turn() as Color;

      if (side === "w") {
        setWTimeMs((t) => {
          const next = t - delta;
          if (next <= 0) {
            stopClock();
            setGameOverText("Game over — Time out. Black wins.");
            setStatusText("");
          }
          return Math.max(0, next);
        });
      } else {
        setBTimeMs((t) => {
          const next = t - delta;
          if (next <= 0) {
            stopClock();
            setGameOverText("Game over — Time out. White wins.");
            setStatusText("");
          }
          return Math.max(0, next);
        });
      }
    }, 200);

    setClockRunning(true);
  }

  function updatePgnMoves() {
    const pgn = chess.pgn();
    const moveText = pgn
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("["))
      .join(" ")
      .trim();

    if (!moveText) {
      setPgnMoves([]);
      return;
    }

    const tokens = moveText.split(/\s+/).filter(Boolean);
    const moves: string[] = [];
    for (const t of tokens) {
      if (/^\d+\.+$/.test(t) || /^\d+\.(\.\.)?$/.test(t) || /^\d+\.\.\.$/.test(t)) continue;
      // strip possible result token like 1-0, 0-1, 1/2-1/2
      if (t === "1-0" || t === "0-1" || t === "1/2-1/2") continue;
      moves.push(t);
    }
    setPgnMoves(moves);
  }

  function refreshUI(nextStatusText?: string) {
    setFen(chess.fen());
    setTurnText(chess.turn() === "w" ? "White" : "Black");

    const check = chess.inCheck();
    setInCheck(check);

    if (chess.isGameOver()) {
      stopClock();

      if (chess.isCheckmate()) {
        const winner = chess.turn() === "w" ? "Black" : "White";
        setGameOverText(`Game over — Checkmate. ${winner} wins.`);
      } else if (chess.isStalemate()) {
        setGameOverText("Game over — Draw (stalemate).");
      } else if (chess.isThreefoldRepetition()) {
        setGameOverText("Game over — Draw (threefold repetition).");
      } else if (chess.isInsufficientMaterial()) {
        setGameOverText("Game over — Draw (insufficient material).");
      } else if (chess.isDraw()) {
        setGameOverText("Game over — Draw.");
      } else {
        setGameOverText("Game over.");
      }
    } else {
      if (!gameOverText.startsWith("Game over — Time out")) {
        setGameOverText("");
      }
    }

    if (nextStatusText !== undefined) {
      setStatusText(nextStatusText);
      return;
    }

    if (gameOverText) setStatusText("");
    else if (check) setStatusText("Check!");
    else setStatusText("");
  }

  function clearSelection() {
    setSelectedSquare(null);
    setHighlightSquares({});
  }

  function legalMovesFrom(square: Square) {
    return chess.moves({ square, verbose: true }) as any[];
  }

  function buildHighlights(square: Square) {
    const moves = legalMovesFrom(square);
    const styles: Record<string, React.CSSProperties> = {};

    styles[square] = {
      background: "rgba(255,255,255,0.12)",
      boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.35)",
    };

    for (const m of moves) {
      const to = m.to as Square;
      const isCapture = Boolean(m.captured);
      styles[to] = {
        background: isCapture ? "rgba(255, 80, 80, 0.35)" : "rgba(120, 255, 120, 0.25)",
        boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.15)",
      };
    }

    setHighlightSquares(styles);
  }

  function isPromotionMove(from: Square, to: Square): boolean {
    const moves = chess.moves({ verbose: true }) as any[];
    return moves.some((m) => m.from === from && m.to === to && m.promotion);
  }

  function pushSnapshot() {
    const snap: Snapshot = {
      fen: chess.fen(),
      lastMove,
      wTimeMs,
      bTimeMs,
      timeControl,
      gameOverText,
      statusText,
    };
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (
        prev &&
        prev.fen === snap.fen &&
        prev.wTimeMs === snap.wTimeMs &&
        prev.bTimeMs === snap.bTimeMs &&
        prev.gameOverText === snap.gameOverText &&
        prev.statusText === snap.statusText
      ) {
        return h;
      }
      return [...h, snap];
    });
  }

  function applyMove(from: Square, to: Square, promotion?: "q" | "r" | "b" | "n"): boolean {
    try {
      const move = chess.move({ from, to, promotion } as any) as any;
      if (!move) return false;

      // any move cancels pending draw offer
      if (drawOffer) setDrawOffer(null);

      startClockIfNeeded();

      setLastMove({ from, to });
      refreshUI("");

      setTimeout(() => {
        updatePgnMoves();
        pushSnapshot();
      }, 0);

      return true;
    } catch {
      setStatusText("Illegal move.");
      return false;
    }
  }

  // CPU reply
  useEffect(() => {
    if (mode !== "cpu") return;
    if (chess.isGameOver()) return;
    if (pendingPromotion) return;
    if (gameOverText) return;

    if (turn !== playerColor) {
      cancelCpuTimer();
      cpuTimerRef.current = setTimeout(() => {
        const move = pickCpuMove(chess, difficulty);
        if (!move) return;

        const m = chess.move(move as any) as any;
        if (!m) return;

        // cpu move cancels any draw offer too
        if (drawOffer) setDrawOffer(null);

        startClockIfNeeded();

        const from = (m.from as string) || (move as any).from;
        const to = (m.to as string) || (move as any).to;
        if (isSquare(from) && isSquare(to)) setLastMove({ from, to });

        clearSelection();
        refreshUI("");

        setTimeout(() => {
          updatePgnMoves();
          pushSnapshot();
        }, 0);
      }, 350);
    }

    return () => cancelCpuTimer();
  }, [fen, mode, playerColor, difficulty, turn, pendingPromotion, gameOverText, drawOffer]);

  // restore saved state on first load
  useEffect(() => {
    const saved = safeJsonParse<SavedStateV1>(localStorage.getItem(STORAGE_KEY));
    if (!saved || saved.v !== 1) {
      refreshUI("");
      updatePgnMoves();
      return;
    }

    try {
      chess.load(saved.fen);
      startFenRef.current = new Chess().fen();

      setMode(saved.mode);
      setDifficulty(saved.difficulty);
      setPlayerColor(saved.playerColor);

      setTimeControl(saved.timeControl);
      setWTimeMs(saved.wTimeMs);
      setBTimeMs(saved.bTimeMs);

      setLastMove(saved.lastMove);

      setScoreWhite(saved.scores.w);
      setScoreBlack(saved.scores.b);
      setScoreDraw(saved.scores.d);

      setFen(chess.fen());
      setTurnText(chess.turn() === "w" ? "White" : "Black");
      setInCheck(chess.inCheck());

      setTimeout(() => {
        updatePgnMoves();
        pushSnapshot();
      }, 0);

      refreshUI("");
    } catch {
      refreshUI("");
      updatePgnMoves();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist on change
  useEffect(() => {
    const payload: SavedStateV1 = {
      v: 1,
      fen,
      mode,
      difficulty,
      playerColor,
      timeControl,
      wTimeMs,
      bTimeMs,
      lastMove,
      scores: { w: scoreWhite, b: scoreBlack, d: scoreDraw },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [fen, mode, difficulty, playerColor, timeControl, wTimeMs, bTimeMs, lastMove, scoreWhite, scoreBlack, scoreDraw]);

  // score update once game ends
  useEffect(() => {
    if (!chess.isGameOver()) return;

    if (chess.isCheckmate()) {
      const winner: Color = chess.turn() === "w" ? "b" : "w";
      if (winner === "w") setScoreWhite((s) => s + 1);
      else setScoreBlack((s) => s + 1);
      return;
    }
    if (chess.isDraw()) setScoreDraw((s) => s + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  function newGame() {
    cancelCpuTimer();
    stopClock();

    chess.reset();
    startFenRef.current = chess.fen();

    clearSelection();
    setPendingPromotion(null);
    setLastMove(null);
    setStatusText("");
    setGameOverText("");
    setDrawOffer(null);

    const init = initialTimeMs(timeControl);
    setWTimeMs(init);
    setBTimeMs(init);
    setClockRunning(false);

    setPgnMoves([]);

    const startSnap: Snapshot = {
      fen: chess.fen(),
      lastMove: null,
      wTimeMs: init,
      bTimeMs: init,
      timeControl,
      gameOverText: "",
      statusText: "",
    };
    setHistory([startSnap]);

    refreshUI("");
    updatePgnMoves();
  }

  function resetTimeControl(tc: TimeControl) {
    stopClock();
    setTimeControl(tc);

    const init = initialTimeMs(tc);
    setWTimeMs(init);
    setBTimeMs(init);

    setClockRunning(false);
    lastTickRef.current = Date.now();

    setTimeout(() => pushSnapshot(), 0);
  }

  function canMovePiece(piece: string): boolean {
    if (pendingPromotion) return false;
    if (chess.isGameOver()) return false;
    if (gameOverText) return false;

    const color = piece[0] as Color;

    if (mode === "friend") {
      return color === (chess.turn() as Color);
    }

    return isPlayerTurn && color === playerColor;
  }

  function undoCpuFullTurn() {
    if (mode !== "cpu") return;

    cancelCpuTimer();
    stopClock();
    clearSelection();
    setPendingPromotion(null);
    setStatusText("");
    setGameOverText("");
    setDrawOffer(null);

    setHistory((h) => {
      if (h.length <= 1) return h;

      const isYourTurnNow = (chess.turn() as Color) === playerColor;
      const undoCount = isYourTurnNow && h.length >= 3 ? 2 : 1;

      const targetIndex = h.length - 1 - undoCount;
      const target = h[targetIndex];

      chess.load(target.fen);

      setLastMove(target.lastMove);
      setWTimeMs(target.wTimeMs);
      setBTimeMs(target.bTimeMs);
      setTimeControl(target.timeControl);
      setStatusText(target.statusText);
      setGameOverText(target.gameOverText);

      setFen(chess.fen());
      setTurnText(chess.turn() === "w" ? "White" : "Black");
      setInCheck(chess.inCheck());

      setTimeout(() => updatePgnMoves(), 0);

      return h.slice(0, h.length - undoCount);
    });
  }

  function resign() {
    if (chess.isGameOver() || gameOverText) return;
    stopClock();

    const loser = chess.turn() === "w" ? "White" : "Black";
    const winner = loser === "White" ? "Black" : "White";

    setGameOverText(`Game over — ${loser} resigned. ${winner} wins.`);
    setStatusText("");
    setDrawOffer(null);
  }

  function offerDraw() {
    if (mode !== "friend") return;
    if (chess.isGameOver() || gameOverText) return;
    if (drawOffer) return;
    setDrawOffer("pending");
    setStatusText("Draw offered. Waiting for response…");
  }

  function acceptDraw() {
    stopClock();
    setGameOverText("Game over — Draw (agreed).");
    setStatusText("");
    setDrawOffer(null);
  }

  function declineDraw() {
    setDrawOffer(null);
    setStatusText("");
  }

  function shareChallenge() {
    const url = typeof window !== "undefined" ? window.location.origin : "";
    const shareText =
      `PaperLink Play Chess\n` +
      `Mode: ${mode === "cpu" ? `CPU (${difficulty})` : "Friend (offline)"}\n` +
      `Open: ${url}\n` +
      `Try the bot: @paperlinkplay_bot`;

    const done = (msg: string) => {
      setShareToast(msg);
      setTimeout(() => setShareToast(""), 1800);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shareText)
        .then(() => done("Copied. Paste in Telegram."))
        .catch(() => done("Copy failed. Long-press to copy text."));
    } else {
      done("Copy not available on this device.");
    }
  }

  function onSquareClick(squareStr: string) {
    if (pendingPromotion) return;
    if (chess.isGameOver()) return;
    if (gameOverText) return;
    if (!isSquare(squareStr)) return;

    const square = squareStr as Square;

    if (!selectedSquare) {
      const piece = chess.get(square);
      if (!piece) return;

      const pieceKey = `${piece.color}${piece.type.toUpperCase()}`;
      if (!canMovePiece(pieceKey)) return;

      setSelectedSquare(square);
      buildHighlights(square);
      return;
    }

    if (selectedSquare === square) {
      clearSelection();
      return;
    }

    const moves = legalMovesFrom(selectedSquare);
    const legalTargets = new Set<Square>(moves.map((m) => m.to as Square));

    if (!legalTargets.has(square)) {
      const piece = chess.get(square);
      if (piece) {
        const pieceKey = `${piece.color}${piece.type.toUpperCase()}`;
        if (!canMovePiece(pieceKey)) return;
        setSelectedSquare(square);
        buildHighlights(square);
        return;
      }
      clearSelection();
      return;
    }

    if (isPromotionMove(selectedSquare, square)) {
      setPendingPromotion({ from: selectedSquare, to: square, color: chess.turn() as Color });
      setStatusText("Pick promotion piece…");
      return;
    }

    const ok = applyMove(selectedSquare, square);
    clearSelection();
    if (!ok) setStatusText("Illegal move.");
  }

  function onPieceDrop(sourceSquareStr: string, targetSquareStr: string, piece: string) {
    if (!canMovePiece(piece)) return false;
    if (!isSquare(sourceSquareStr) || !isSquare(targetSquareStr)) return false;

    const from = sourceSquareStr as Square;
    const to = targetSquareStr as Square;

    if (from === to) {
      setSelectedSquare(from);
      buildHighlights(from);
      return false;
    }

    if (isPromotionMove(from, to)) {
      setPendingPromotion({ from, to, color: chess.turn() as Color });
      setStatusText("Pick promotion piece…");
      return false;
    }

    const ok = applyMove(from, to);
    clearSelection();
    return ok;
  }

  function choosePromotion(p: "q" | "r" | "b" | "n") {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;

    const ok = applyMove(from, to, p);
    setPendingPromotion(null);
    clearSelection();

    if (!ok) setStatusText("Illegal move.");
  }

  // Styles
  const lastMoveStyles = useMemo(() => {
    if (!lastMove) return {};
    return {
      [lastMove.from]: {
        background: "rgba(255, 215, 0, 0.20)",
        boxShadow: "inset 0 0 0 3px rgba(255, 215, 0, 0.35)",
      },
      [lastMove.to]: {
        background: "rgba(255, 215, 0, 0.28)",
        boxShadow: "inset 0 0 0 3px rgba(255, 215, 0, 0.45)",
      },
    } as Record<string, React.CSSProperties>;
  }, [lastMove]);

  const checkKingStyles = useMemo(() => {
    if (!inCheck || chess.isGameOver() || gameOverText) return {};
    const kingSq = findKingSquare(chess, chess.turn() as Color);
    if (!kingSq) return {};
    return {
      [kingSq]: { boxShadow: "inset 0 0 0 4px rgba(255, 0, 0, 0.65)" },
    } as Record<string, React.CSSProperties>;
  }, [inCheck, fen, gameOverText]);

  const mergedSquareStyles = useMemo(() => {
    return { ...lastMoveStyles, ...highlightSquares, ...checkKingStyles };
  }, [lastMoveStyles, highlightSquares, checkKingStyles]);

  const boardOrientation = mode === "cpu" ? (playerColor === "w" ? "white" : "black") : "white";
  const showClock = timeControl !== "open";

  const canUndoCpu = useMemo(() => {
    if (mode !== "cpu") return false;
    if (chess.isGameOver()) return false;
    if (gameOverText) return false;
    return history.length >= 2;
  }, [mode, history.length, fen, gameOverText]);

  const captured = useMemo(() => capturedFromFen(startFenRef.current, fen), [fen]);

  return (
    <div
      style={{
        background: "#0B1220",
        color: "white",
        minHeight: "100vh",
        padding: 16,
        boxSizing: "border-box",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {/* Top Panel */}
        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 14, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setMode("cpu");
                  newGame();
                }}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: mode === "cpu" ? "white" : "transparent",
                  color: mode === "cpu" ? "black" : "white",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                vs CPU
              </button>

              <button
                onClick={() => {
                  setMode("friend");
                  newGame();
                }}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: mode === "friend" ? "white" : "transparent",
                  color: mode === "friend" ? "black" : "white",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                vs Friend (offline)
              </button>

              <button
                onClick={() => shareChallenge()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Share
              </button>

              <button
                onClick={() => resign()}
                disabled={Boolean(gameOverText) || chess.isGameOver()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,80,80,0.12)",
                  color: "white",
                  cursor: Boolean(gameOverText) || chess.isGameOver() ? "not-allowed" : "pointer",
                  fontWeight: 900,
                  opacity: Boolean(gameOverText) || chess.isGameOver() ? 0.5 : 1,
                }}
              >
                Resign
              </button>
            </div>

            <button
              onClick={() => newGame()}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              New game
            </button>
          </div>

          {shareToast ? (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", fontWeight: 900 }}>
              {shareToast}
            </div>
          ) : null}

          {/* Undo row */}
          {mode === "cpu" && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => undoCpuFullTurn()}
                disabled={!canUndoCpu}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: canUndoCpu ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                  color: "white",
                  cursor: canUndoCpu ? "pointer" : "not-allowed",
                  fontWeight: 900,
                  opacity: canUndoCpu ? 1 : 0.55,
                }}
              >
                Undo (CPU) — removes your move and CPU reply
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 6 }}>Time</div>
              <select
                value={timeControl}
                onChange={(e) => resetTimeControl(e.target.value as TimeControl)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  outline: "none",
                }}
              >
                <option value="open">Open (no timer)</option>
                <option value="blitz">Blitz (5:00)</option>
                <option value="rapid">Rapid (10:00)</option>
              </select>
            </div>

            <div style={{ flex: "1 1 160px" }}>
              <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 6 }}>Your color</div>
              <select
                value={playerColor}
                onChange={(e) => {
                  setPlayerColor(e.target.value as Color);
                  newGame();
                }}
                disabled={mode !== "cpu"}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  outline: "none",
                  opacity: mode === "cpu" ? 1 : 0.6,
                }}
              >
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </div>

            <div style={{ flex: "1 1 160px" }}>
              <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 6 }}>Difficulty</div>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                disabled={mode !== "cpu"}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  outline: "none",
                  opacity: mode === "cpu" ? 1 : 0.6,
                }}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          {showClock && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: (chess.turn() === "w" && !gameOverText) ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)" }}>
                <div style={{ opacity: 0.75, fontSize: 12 }}>White</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatMs(wTimeMs)}</div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: (chess.turn() === "b" && !gameOverText) ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)" }}>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Black</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatMs(bTimeMs)}</div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", minWidth: 180 }}>
              <div style={{ opacity: 0.8, fontSize: 12 }}>Turn</div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{turnText}</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {mode === "friend" && !gameOverText && !chess.isGameOver() && (
                <button
                  onClick={() => offerDraw()}
                  disabled={Boolean(drawOffer)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: Boolean(drawOffer) ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
                    color: "white",
                    cursor: Boolean(drawOffer) ? "not-allowed" : "pointer",
                    fontWeight: 900,
                    opacity: Boolean(drawOffer) ? 0.6 : 1,
                  }}
                >
                  Offer draw
                </button>
              )}

              {inCheck && !chess.isGameOver() && !gameOverText && (
                <div style={{ padding: "10px 14px", borderRadius: 999, background: "rgba(255,0,0,0.25)", border: "1px solid rgba(255,0,0,0.55)", color: "white", fontWeight: 900 }}>
                  CHECK
                </div>
              )}
              {(chess.isGameOver() || gameOverText) && (
                <div style={{ padding: "10px 14px", borderRadius: 999, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "white", fontWeight: 800 }}>
                  Game over
                </div>
              )}
            </div>
          </div>

          {drawOffer === "pending" && mode === "friend" && !gameOverText && !chess.isGameOver() && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
              <div style={{ fontWeight: 900 }}>Draw offer</div>
              <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                Other player: accept or decline.
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button onClick={() => acceptDraw()} style={pillBtnPrimary}>Accept</button>
                <button onClick={() => declineDraw()} style={pillBtn}>Decline</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", opacity: 0.9, fontSize: 13 }}>
            <div>White: {scoreWhite}</div>
            <div>Draws: {scoreDraw}</div>
            <div>Black: {scoreBlack}</div>
          </div>
        </div>

        {/* Board + Side Panels */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)" }}>
            <Chessboard
              position={fen}
              onPieceDrop={onPieceDrop}
              onSquareClick={onSquareClick}
              boardOrientation={boardOrientation}
              arePiecesDraggable={!pendingPromotion && !chess.isGameOver() && !gameOverText}
              customSquareStyles={mergedSquareStyles}
              customBoardStyle={{ borderRadius: 18, overflow: "hidden" }}
            />
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Captured by White</div>
                <div style={{ marginTop: 6, fontWeight: 900 }}>
                  {captured.whiteCaptured.length ? captured.whiteCaptured.join(" ") : "—"}
                </div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Captured by Black</div>
                <div style={{ marginTop: 6, fontWeight: 900 }}>
                  {captured.blackCaptured.length ? captured.blackCaptured.join(" ") : "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Move history</div>
              <div style={{ marginTop: 8, maxHeight: 160, overflow: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", padding: 10, background: "rgba(0,0,0,0.15)" }}>
                {pgnMoves.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {Array.from({ length: Math.ceil(pgnMoves.length / 2) }).map((_, i) => {
                      const w = pgnMoves[i * 2];
                      const b = pgnMoves[i * 2 + 1];
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr 1fr", gap: 8, alignItems: "center" }}>
                          <div style={{ opacity: 0.7, fontSize: 12 }}>{i + 1}.</div>
                          <div style={{ fontWeight: 900 }}>{w ?? ""}</div>
                          <div style={{ fontWeight: 900, opacity: 0.9 }}>{b ?? ""}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ opacity: 0.7 }}>No moves yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {gameOverText ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)", fontWeight: 900 }}>
            {gameOverText}
          </div>
        ) : statusText ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)", fontWeight: 900 }}>
            {statusText}
          </div>
        ) : null}

        <div style={{ opacity: 0.7, fontSize: 12, padding: "8px 2px", textAlign: "center" }}>
          Mode: {mode === "cpu" ? `CPU (${difficulty})` : "Friend (offline)"} · {mode === "cpu" ? `You: ${playerColor === "w" ? "White" : "Black"}` : "Pass-and-play"}
        </div>
      </div>

      {pendingPromotion && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 14, boxSizing: "border-box", zIndex: 50 }}>
          <div style={{ width: "100%", maxWidth: 520, borderRadius: 18, border: "1px solid rgba(255,255,255,0.14)", background: "#0F172A", padding: 14, boxSizing: "border-box" }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Promote pawn to</div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>Choose a piece.</div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => choosePromotion("q")} style={promoBtnStyle}>Queen</button>
              <button onClick={() => choosePromotion("r")} style={promoBtnStyle}>Rook</button>
              <button onClick={() => choosePromotion("b")} style={promoBtnStyle}>Bishop</button>
              <button onClick={() => choosePromotion("n")} style={promoBtnStyle}>Knight</button>
            </div>

            <button
              onClick={() => {
                setPendingPromotion(null);
                clearSelection();
                setStatusText("");
              }}
              style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white", cursor: "pointer", fontWeight: 900 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const promoBtnStyle: React.CSSProperties = {
  flex: "1 1 120px",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const pillBtn: React.CSSProperties = {
  flex: 1,
  padding: "12px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const pillBtnPrimary: React.CSSProperties = {
  ...pillBtn,
  background: "white",
  color: "black",
  border: "1px solid rgba(255,255,255,0.12)",
};