"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { PromotionSheet } from "./PromotionSheet";

type Mode = "cpu" | "friend";
type Difficulty = "easy" | "medium" | "hard";
type Color = "white" | "black";
type PromotionPiece = "q" | "r" | "b" | "n";

type PendingPromotion = {
  from: string;
  to: string;
  colorToMove: Color;
};

function isPromotionMove(game: Chess, from: string, to: string) {
  const piece = game.get(from as any);
  if (!piece) return false;
  if (piece.type !== "p") return false;

  const toRank = to[1];
  if (piece.color === "w" && toRank === "8") return true;
  if (piece.color === "b" && toRank === "1") return true;
  return false;
}

function opposite(c: Color): Color {
  return c === "white" ? "black" : "white";
}

function pickCpuMove(game: Chess, difficulty: Difficulty) {
  const moves = game.moves({ verbose: true }) as any[];
  if (moves.length === 0) return null;

  if (difficulty === "easy") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (difficulty === "medium") {
    const captures = moves.filter((m) => !!m.captured);
    const pool = captures.length ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  const scorePosition = (g: Chess) => {
    const b = g.board();
    let s = 0;
    for (const row of b) {
      for (const p of row) {
        if (!p) continue;
        const v = value[p.type] ?? 0;
        s += p.color === "w" ? v : -v;
      }
    }
    return s;
  };

  const side: Color = game.turn() === "w" ? "white" : "black";
  const wantMax = side === "white";

  let best = moves[0];
  let bestScore = wantMax ? -Infinity : Infinity;

  for (const m of moves) {
    const g1 = new Chess(game.fen());
    g1.move(m);

    const replies = g1.moves({ verbose: true }) as any[];
    let replyScore: number;

    if (replies.length === 0) {
      replyScore = scorePosition(g1);
      if (g1.isCheckmate()) replyScore += wantMax ? 999 : -999;
    } else {
      let worstForUs = wantMax ? Infinity : -Infinity;
      for (const r of replies) {
        const g2 = new Chess(g1.fen());
        g2.move(r);
        const sc = scorePosition(g2);
        if (wantMax) {
          if (sc < worstForUs) worstForUs = sc;
        } else {
          if (sc > worstForUs) worstForUs = sc;
        }
      }
      replyScore = worstForUs;
    }

    if (wantMax) {
      if (replyScore > bestScore) {
        bestScore = replyScore;
        best = m;
      }
    } else {
      if (replyScore < bestScore) {
        bestScore = replyScore;
        best = m;
      }
    }
  }

  return best;
}

function findKingSquare(g: Chess, turn: "w" | "b") {
  const board = g.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (p.type === "k" && p.color === turn) {
        const file = "abcdefgh"[c];
        const rank = String(8 - r);
        return `${file}${rank}`;
      }
    }
  }
  return null;
}

export default function ChessGame() {
  const [mode, setMode] = useState<Mode>("cpu");
  const [yourColor, setYourColor] = useState<Color>("white");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [randomFirst, setRandomFirst] = useState(true);

  const [game, setGame] = useState(() => new Chess());
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [statusText, setStatusText] = useState<string>("");
  const [statusKind, setStatusKind] = useState<"info" | "check" | "over" | "error">("info");

  const [promotionOpen, setPromotionOpen] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  const [score, setScore] = useState({ white: 0, black: 0, draws: 0 });

  const busyCpuRef = useRef(false);

  const fen = game.fen();
  const turnColor: Color = game.turn() === "w" ? "white" : "black";
  const youToMove = mode === "friend" ? true : turnColor === yourColor;
  const gameOver = game.isGameOver();

  const boardOrientation = useMemo(() => (yourColor === "white" ? "white" : "black"), [yourColor]);

  const resetHighlights = () => {
    setSelectedSquare(null);
    setLegalTargets([]);
  };

  const setBanner = (kind: typeof statusKind, text: string) => {
    setStatusKind(kind);
    setStatusText(text);
  };

  const recomputeBanner = (g: Chess) => {
    if (g.isCheckmate()) {
      const winner = g.turn() === "w" ? "black" : "white";
      setBanner("over", `✅ Checkmate — ${winner.toUpperCase()} wins.`);
      return;
    }
    if (g.isStalemate()) {
      setBanner("over", "✅ Game over — Draw (stalemate).");
      return;
    }
    if (g.isDraw()) {
      setBanner("over", "✅ Game over — Draw.");
      return;
    }
    if (g.inCheck()) {
      setBanner("check", "CHECK");
      return;
    }
    setBanner("info", "");
  };

  const safeApplyMove = (from: string, to: string, promotion?: PromotionPiece) => {
    const g = new Chess(game.fen());
    const move = g.move({ from, to, promotion } as any);
    if (!move) {
      setBanner("error", "Illegal move.");
      return null;
    }
    setGame(g);
    recomputeBanner(g);
    return g;
  };

  const startNewGame = () => {
    const g = new Chess();
    setGame(g);
    resetHighlights();
    setPromotionOpen(false);
    setPendingPromotion(null);
    setBanner("info", "");
    recomputeBanner(g);

    if (mode === "cpu" && randomFirst) {
      const c: Color = Math.random() < 0.5 ? "white" : "black";
      setYourColor(c);
    }
  };

  useEffect(() => {
    recomputeBanner(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  useEffect(() => {
    if (mode !== "cpu") return;
    if (gameOver) return;
    if (promotionOpen) return;
    if (busyCpuRef.current) return;

    const cpuColor = opposite(yourColor);
    const cpuToMove = turnColor === cpuColor;
    if (!cpuToMove) return;

    busyCpuRef.current = true;

    const t = setTimeout(() => {
      try {
        const g = new Chess(game.fen());
        const move = pickCpuMove(g, difficulty);
        if (!move) return;

        const needsPromo = isPromotionMove(g, move.from, move.to);
        g.move({ from: move.from, to: move.to, promotion: needsPromo ? "q" : undefined } as any);

        setGame(g);
        recomputeBanner(g);
        resetHighlights();
      } finally {
        busyCpuRef.current = false;
      }
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, mode, yourColor, difficulty, promotionOpen, gameOver, turnColor]);

  const computeLegalTargets = (square: string) => {
    const moves = game.moves({ square: square as any, verbose: true }) as any[];
    return moves.map((m) => m.to);
  };

  const onSquareClick = (sq: string) => {
    if (promotionOpen) return;
    if (gameOver) return;
    if (mode === "cpu" && !youToMove) return;

    if (!selectedSquare) {
      const p = game.get(sq as any);
      if (!p) return;
      const isYourPieceToMove =
        (p.color === "w" && game.turn() === "w") || (p.color === "b" && game.turn() === "b");
      if (!isYourPieceToMove) return;

      setSelectedSquare(sq);
      setLegalTargets(computeLegalTargets(sq));
      return;
    }

    if (selectedSquare === sq) {
      resetHighlights();
      return;
    }

    if (legalTargets.includes(sq)) {
      if (isPromotionMove(game, selectedSquare, sq)) {
        setPendingPromotion({ from: selectedSquare, to: sq, colorToMove: turnColor });
        setPromotionOpen(true);
        setBanner("info", "Pick promotion piece…");
        return;
      }

      const next = safeApplyMove(selectedSquare, sq);
      if (next) resetHighlights();
      return;
    }

    const p2 = game.get(sq as any);
    if (p2) {
      const isYourPieceToMove =
        (p2.color === "w" && game.turn() === "w") || (p2.color === "b" && game.turn() === "b");
      if (isYourPieceToMove) {
        setSelectedSquare(sq);
        setLegalTargets(computeLegalTargets(sq));
        return;
      }
    }

    resetHighlights();
  };

  const onPieceDrop = (sourceSquare: string, targetSquare: string) => {
    if (promotionOpen) return false;
    if (gameOver) return false;
    if (mode === "cpu" && !youToMove) return false;

    if (isPromotionMove(game, sourceSquare, targetSquare)) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare, colorToMove: turnColor });
      setPromotionOpen(true);
      setBanner("info", "Pick promotion piece…");
      resetHighlights();
      return false;
    }

    const next = safeApplyMove(sourceSquare, targetSquare);
    if (next) resetHighlights();
    return !!next;
  };

  const onPickPromotion = (p: PromotionPiece) => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;

    safeApplyMove(from, to, p);
    setPromotionOpen(false);
    setPendingPromotion(null);
    resetHighlights();
  };

  useEffect(() => {
    if (!game.isGameOver()) return;

    if (game.isCheckmate()) {
      const winner: Color = game.turn() === "w" ? "black" : "white";
      setScore((s) => ({
        ...s,
        white: s.white + (winner === "white" ? 1 : 0),
        black: s.black + (winner === "black" ? 1 : 0),
      }));
      return;
    }

    if (game.isStalemate() || game.isDraw()) {
      setScore((s) => ({ ...s, draws: s.draws + 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (selectedSquare) {
      styles[selectedSquare] = {
        boxShadow: "inset 0 0 0 4px rgba(255,255,255,.35)",
      };
    }

    for (const t of legalTargets) {
      styles[t] = {
        boxShadow: "inset 0 0 0 4px rgba(0,200,255,.35)",
      };
    }

    if (game.inCheck()) {
      const kingSquare = findKingSquare(game, game.turn());
      if (kingSquare) {
        styles[kingSquare] = {
          boxShadow: "inset 0 0 0 4px rgba(255,0,0,.55)",
        };
      }
    }

    return styles;
  }, [selectedSquare, legalTargets, game]);

  const pillStyle = (kind: typeof statusKind): React.CSSProperties => {
    if (kind === "check") {
      return {
        padding: "8px 12px",
        borderRadius: 999,
        background: "rgba(255,0,0,.75)",
        color: "white",
        fontWeight: 800,
        letterSpacing: 0.5,
      };
    }
    if (kind === "over") {
      return {
        padding: "8px 12px",
        borderRadius: 999,
        background: "rgba(0,180,90,.45)",
        border: "1px solid rgba(0,180,90,.55)",
        color: "white",
        fontWeight: 800,
      };
    }
    if (kind === "error") {
      return {
        padding: "8px 12px",
        borderRadius: 999,
        background: "rgba(255,120,0,.35)",
        border: "1px solid rgba(255,120,0,.5)",
        color: "white",
        fontWeight: 800,
      };
    }
    return {
      padding: "8px 12px",
      borderRadius: 999,
      background: "rgba(255,255,255,.06)",
      border: "1px solid rgba(255,255,255,.14)",
      color: "rgba(255,255,255,.85)",
      fontWeight: 700,
    };
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          padding: 12,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(255,255,255,.04)",
          color: "white",
          fontWeight: 700,
        }}
      >
        <div>White: {score.white}</div>
        <div style={{ textAlign: "center" }}>Draws: {score.draws}</div>
        <div style={{ textAlign: "right" }}>Black: {score.black}</div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 10,
          padding: 12,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(255,255,255,.04)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setMode("cpu");
              startNewGame();
            }}
            style={{
              padding: "12px 10px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.14)",
              background: mode === "cpu" ? "white" : "rgba(255,255,255,.06)",
              color: mode === "cpu" ? "black" : "white",
              fontWeight: 800,
            }}
          >
            vs CPU
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("friend");
              startNewGame();
            }}
            style={{
              padding: "12px 10px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.14)",
              background: mode === "friend" ? "white" : "rgba(255,255,255,.06)",
              color: mode === "friend" ? "black" : "white",
              fontWeight: 800,
            }}
          >
            vs Friend
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, marginBottom: 6 }}>Your color</div>
            <select
              value={yourColor}
              onChange={(e) => {
                setYourColor(e.target.value as Color);
                startNewGame();
              }}
              style={{
                width: "100%",
                padding: "12px 10px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.14)",
                background: "rgba(255,255,255,.06)",
                color: "white",
                fontWeight: 700,
              }}
              disabled={mode !== "cpu"}
            >
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </div>

          <div>
            <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, marginBottom: 6 }}>Difficulty</div>
            <select
              value={difficulty}
              onChange={(e) => {
                setDifficulty(e.target.value as Difficulty);
                startNewGame();
              }}
              style={{
                width: "100%",
                padding: "12px 10px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.14)",
                background: "rgba(255,255,255,.06)",
                color: "white",
                fontWeight: 700,
              }}
              disabled={mode !== "cpu"}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        {mode === "cpu" && (
          <label style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,.85)" }}>
            <input type="checkbox" checked={randomFirst} onChange={(e) => setRandomFirst(e.target.checked)} />
            Random first mover (randomize your color on new game)
          </label>
        )}

        <button
          type="button"
          onClick={startNewGame}
          style={{
            padding: "12px 10px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,.14)",
            background: "rgba(255,255,255,.06)",
            color: "white",
            fontWeight: 800,
          }}
        >
          New game
        </button>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 12,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(255,255,255,.04)",
          gap: 10,
        }}
      >
        <div style={{ color: "white", fontWeight: 800 }}>Turn: {turnColor === "white" ? "White" : "Black"}</div>
        {statusText ? <div style={pillStyle(statusKind)}>{statusText}</div> : <div />}
      </div>

      <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,.12)" }}>
        <Chessboard
          position={game.fen()}
          onSquareClick={onSquareClick}
          onPieceDrop={onPieceDrop}
          boardOrientation={boardOrientation}
          customSquareStyles={customSquareStyles}
          arePiecesDraggable={true}
        />
      </div>

      <PromotionSheet
        open={promotionOpen}
        sideLabel={pendingPromotion?.colorToMove === "white" ? "White" : "Black"}
        onPick={onPickPromotion}
        onClose={() => {
          setPromotionOpen(false);
          setPendingPromotion(null);
          setBanner("info", "");
        }}
      />
    </div>
  );
}