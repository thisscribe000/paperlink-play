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
  wTimeMs: number; // 0 means not used if open
  bTimeMs: number;
  timeControl: TimeControl;
  gameOverText: string;
  statusText: string;
};

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
  return 10 * 60 * 1000; // rapid
}

export default function ChessGame() {
  const chessRef = useRef(new Chess());
  const chess = chessRef.current;

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
  const [highlightSquares, setHighlightSquares] = useState<Record<string, React.CSSProperties>>(
    {}
  );

  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [lastMove, setLastMove] = useState<LastMove>(null);

  // Timer system
  const [timeControl, setTimeControl] = useState<TimeControl>("open");
  const [wTimeMs, setWTimeMs] = useState<number>(initialTimeMs("open"));
  const [bTimeMs, setBTimeMs] = useState<number>(initialTimeMs("open"));
  const [clockRunning, setClockRunning] = useState(false);

  // History snapshots for undo (and later for persistence)
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

      // Only tick while game is active and not in promotion selection
      if (pendingPromotion) return;
      if (chess.isGameOver()) return;
      if (gameOverText) return;

      const side = chess.turn() as Color;

      if (side === "w") {
        setWTimeMs((t) => {
          const next = t - delta;
          if (next <= 0) {
            // White ran out of time => Black wins
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
            // Black ran out of time => White wins
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
      // keep time-out text if already set
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
      if (prev && prev.fen === snap.fen && prev.wTimeMs === snap.wTimeMs && prev.bTimeMs === snap.bTimeMs) {
        return h;
      }
      return [...h, snap];
    });
  }

  function applyMove(from: Square, to: Square, promotion?: "q" | "r" | "b" | "n"): boolean {
    try {
      const move = chess.move({ from, to, promotion } as any) as any;
      if (!move) return false;

      // start clock on first real move
      startClockIfNeeded();

      setLastMove({ from, to });
      setStatusText("");
      refreshUI("");

      // snapshot after move (with updated fen)
      setTimeout(() => pushSnapshot(), 0);

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

        startClockIfNeeded();

        const from = (m.from as string) || (move as any).from;
        const to = (m.to as string) || (move as any).to;
        if (isSquare(from) && isSquare(to)) setLastMove({ from, to });

        clearSelection();
        refreshUI("");

        setTimeout(() => pushSnapshot(), 0);
      }, 350);
    }

    return () => cancelCpuTimer();
  }, [fen, mode, playerColor, difficulty, turn, pendingPromotion, gameOverText]);

  // initial
  useEffect(() => {
    refreshUI("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    clearSelection();
    setPendingPromotion(null);
    setLastMove(null);
    setStatusText("");
    setGameOverText("");

    const init = initialTimeMs(timeControl);
    setWTimeMs(init);
    setBTimeMs(init);

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
  }

  function resetTimeControl(tc: TimeControl) {
    stopClock();
    setTimeControl(tc);
    const init = initialTimeMs(tc);
    setWTimeMs(init);
    setBTimeMs(init);
    setClockRunning(false);
    lastTickRef.current = Date.now();

    // do not reset game automatically; just reset clocks
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

    setHistory((h) => {
      if (h.length <= 1) return h;

      // Determine how many plies to undo:
      // if it's player's turn now, CPU has likely moved => undo 2 snapshots if possible
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

      return h.slice(0, h.length - undoCount);
    });
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
      return false; // snapback until chosen
    }

    const ok = applyMove(from, to);
    clearSelection();
    return ok; // false => snapback
  }

  function choosePromotion(p: "q" | "r" | "b" | "n") {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;

    const ok = applyMove(from, to, p);
    setPendingPromotion(null);
    clearSelection();

    if (!ok) setStatusText("Illegal move.");
  }

  // Square styles: last move + legal highlights + checked king
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
      [kingSq]: {
        boxShadow: "inset 0 0 0 4px rgba(255, 0, 0, 0.65)",
      },
    } as Record<string, React.CSSProperties>;
  }, [inCheck, fen, gameOverText]);

  const mergedSquareStyles = useMemo(() => {
    return {
      ...lastMoveStyles,
      ...highlightSquares,
      ...checkKingStyles,
    };
  }, [lastMoveStyles, highlightSquares, checkKingStyles]);

  const boardOrientation = mode === "cpu" ? (playerColor === "w" ? "white" : "black") : "white";

  const canUndoCpu = useMemo(() => {
    if (mode !== "cpu") return false;
    if (chess.isGameOver()) return false;
    if (gameOverText) return false;
    return history.length >= 2;
  }, [mode, history.length, fen, gameOverText]);

  const showClock = timeControl !== "open";

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
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 16,
            padding: 14,
            background: "rgba(255,255,255,0.04)",
          }}
        >
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
                  fontWeight: 700,
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
                  fontWeight: 700,
                }}
              >
                vs Friend (offline)
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
                fontWeight: 700,
              }}
            >
              New game
            </button>
          </div>

          {/* Undo row (CPU only, always visible in CPU mode) */}
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
                  fontWeight: 800,
                  opacity: canUndoCpu ? 1 : 0.55,
                }}
              >
                Undo (CPU) — removes your move and CPU reply
              </button>
              <div style={{ opacity: 0.65, fontSize: 12, marginTop: 6 }}>
                Undo becomes active after at least one move is made.
              </div>
            </div>
          )}

          {/* Time control */}
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

          {/* Clocks */}
          {showClock && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: (chess.turn() === "w" && !gameOverText) ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ opacity: 0.75, fontSize: 12 }}>White</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatMs(wTimeMs)}</div>
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: (chess.turn() === "b" && !gameOverText) ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ opacity: 0.75, fontSize: 12 }}>Black</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{formatMs(bTimeMs)}</div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12, lineHeight: 1.35 }}>
            Tap a piece to highlight legal moves. Drag-drop illegal moves snap back. Last move is highlighted.
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", minWidth: 180 }}>
              <div style={{ opacity: 0.8, fontSize: 12 }}>Turn</div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{turnText}</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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

          <div style={{ marginTop: 10, display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", opacity: 0.9, fontSize: 13 }}>
            <div>White: {scoreWhite}</div>
            <div>Draws: {scoreDraw}</div>
            <div>Black: {scoreBlack}</div>
          </div>
        </div>

        {gameOverText ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)", fontWeight: 800 }}>
            {gameOverText}
          </div>
        ) : statusText ? (
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)", fontWeight: 800 }}>
            {statusText}
          </div>
        ) : null}

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
              style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white", cursor: "pointer", fontWeight: 800 }}
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