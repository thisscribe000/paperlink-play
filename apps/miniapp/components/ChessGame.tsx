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

function isSquare(v: string): v is Square {
  // a1..h8
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

  // hard: simple 1-ply evaluation
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

export default function ChessGame() {
  const chessRef = useRef(new Chess());
  const chess = chessRef.current;

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

  const turn = chess.turn() as Color;

  const isPlayerTurn = useMemo(() => {
    if (mode === "friend") return true;
    return turn === playerColor;
  }, [mode, turn, playerColor]);

  function refreshUI() {
    setFen(chess.fen());

    const t = chess.turn() === "w" ? "White" : "Black";
    setTurnText(t);

    const check = chess.inCheck();
    setInCheck(check);

    const over = chess.isGameOver();
    if (!over) {
      setGameOverText("");
    } else {
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
    }

    if (over) setStatusText(gameOverText || "Game over.");
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

  function applyMove(from: Square, to: Square, promotion?: "q" | "r" | "b" | "n"): boolean {
    try {
      const move = chess.move({ from, to, promotion } as any);
      if (!move) return false;
      refreshUI();
      return true;
    } catch {
      return false;
    }
  }

  // CPU reply
  useEffect(() => {
    if (mode !== "cpu") return;
    if (chess.isGameOver()) return;

    if (turn !== playerColor) {
      const timer = setTimeout(() => {
        const move = pickCpuMove(chess, difficulty);
        if (!move) return;
        chess.move(move as any);
        clearSelection();
        refreshUI();
      }, 350);

      return () => clearTimeout(timer);
    }
  }, [fen, mode, playerColor, difficulty, turn]);

  // initial
  useEffect(() => {
    refreshUI();
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
    chess.reset();
    clearSelection();
    refreshUI();
  }

  function canMovePiece(piece: string): boolean {
    const color = piece[0] as Color;

    if (mode === "friend") {
      // offline pass-and-play: only side to move can move
      return color === (chess.turn() as Color);
    }

    // CPU mode: only your pieces, and only on your turn
    return isPlayerTurn && color === playerColor;
  }

  function onSquareClick(squareStr: string) {
    if (pendingPromotion) return;
    if (chess.isGameOver()) return;
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
        if (canMovePiece(pieceKey)) {
          setSelectedSquare(square);
          buildHighlights(square);
          return;
        }
      }
      clearSelection();
      return;
    }

    if (isPromotionMove(selectedSquare, square)) {
      setPendingPromotion({ from: selectedSquare, to: square, color: chess.turn() as Color });
      return;
    }

    const ok = applyMove(selectedSquare, square);
    clearSelection();
    if (!ok) refreshUI();
  }

  function onPieceDrop(sourceSquareStr: string, targetSquareStr: string, piece: string) {
    if (pendingPromotion) return false;
    if (chess.isGameOver()) return false;
    if (!canMovePiece(piece)) return false;

    if (!isSquare(sourceSquareStr) || !isSquare(targetSquareStr)) return false;

    const sourceSquare = sourceSquareStr as Square;
    const targetSquare = targetSquareStr as Square;

    if (sourceSquare === targetSquare) {
      setSelectedSquare(sourceSquare);
      buildHighlights(sourceSquare);
      return false;
    }

    if (isPromotionMove(sourceSquare, targetSquare)) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare, color: chess.turn() as Color });
      return false; // snapback until they pick
    }

    const ok = applyMove(sourceSquare, targetSquare);
    clearSelection();
    return ok; // false => snapback (what you want)
  }

  function choosePromotion(p: "q" | "r" | "b" | "n") {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;

    const ok = applyMove(from, to, p);
    setPendingPromotion(null);
    clearSelection();
    if (!ok) refreshUI();
  }

  const boardOrientation = mode === "cpu" ? (playerColor === "w" ? "white" : "black") : "white";

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
        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 14, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                  fontWeight: 600,
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
                  fontWeight: 600,
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
                fontWeight: 600,
              }}
            >
              New game
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px" }}>
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

            <div style={{ flex: "1 1 180px" }}>
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

          <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12, lineHeight: 1.35 }}>
            Tap a piece/square to highlight legal moves, then tap a highlighted square to move. Drag also works. Illegal drops snap back.
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", minWidth: 180 }}>
              <div style={{ opacity: 0.8, fontSize: 12 }}>Turn</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{turnText}</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {inCheck && !chess.isGameOver() && (
                <div style={{ padding: "10px 14px", borderRadius: 999, background: "rgba(255,0,0,0.25)", border: "1px solid rgba(255,0,0,0.55)", color: "white", fontWeight: 800 }}>
                  CHECK
                </div>
              )}
              {chess.isGameOver() && (
                <div style={{ padding: "10px 14px", borderRadius: 999, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "white", fontWeight: 700 }}>
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
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.04)", fontWeight: 700 }}>
            {gameOverText}
          </div>
        ) : statusText ? (
          <div style={{ border: "1px solid rgba(255,0,0,0.35)", borderRadius: 16, padding: 12, background: "rgba(255,0,0,0.10)", fontWeight: 700 }}>
            {statusText}
          </div>
        ) : null}

        <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)" }}>
          <Chessboard
            position={fen}
            onPieceDrop={onPieceDrop}
            onSquareClick={onSquareClick}
            boardOrientation={boardOrientation}
            arePiecesDraggable={!pendingPromotion && !chess.isGameOver()}
            customSquareStyles={highlightSquares}
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
            <div style={{ fontWeight: 800, fontSize: 16 }}>Promote pawn to</div>
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
              }}
              style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "white", cursor: "pointer", fontWeight: 700 }}
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
  fontWeight: 800,
};