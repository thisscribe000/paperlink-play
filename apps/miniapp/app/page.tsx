"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess, Square, Move } from "chess.js";
import { Chessboard } from "react-chessboard";

type Mode = "cpu" | "friend";
type Difficulty = "easy" | "medium" | "hard";
type PlayerColor = "w" | "b";

function randomItem<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isCapture(m: Move) {
  // chess.js verbose Move has flags; capture includes 'c' or 'e'
  return (m.flags || "").includes("c") || (m.flags || "").includes("e");
}

function materialScore(chess: Chess) {
  // simple material evaluation (white positive)
  const pieceValues: Record<string, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 0,
  };

  const board = chess.board();
  let score = 0;

  for (const row of board) {
    for (const p of row) {
      if (!p) continue;
      const v = pieceValues[p.type] ?? 0;
      score += p.color === "w" ? v : -v;
    }
  }
  return score;
}

function chooseCpuMove(chess: Chess, difficulty: Difficulty): Move | null {
  const moves = chess.moves({ verbose: true }) as Move[];
  if (!moves.length) return null;

  if (difficulty === "easy") {
    return randomItem(moves) ?? null;
  }

  if (difficulty === "medium") {
    // Prefer captures; otherwise random
    const captures = moves.filter(isCapture);
    return (randomItem(captures.length ? captures : moves) ?? null);
  }

  // hard: 1-ply lookahead by material evaluation
  const cpuColor = chess.turn(); // whose turn now
  let best: { move: Move; score: number } | null = null;

  for (const m of moves) {
    const copy = new Chess(chess.fen());
    copy.move(m);

    const s = materialScore(copy);
    // If CPU is black, it wants LOWER score (more negative),
    // if CPU is white, it wants HIGHER score.
    const objective = cpuColor === "w" ? s : -s;

    if (!best || objective > best.score) {
      best = { move: m, score: objective };
    }
  }

  return best?.move ?? null;
}

export default function Home() {
  // Core game
  const [game, setGame] = useState(() => new Chess());

  // UX selection
  const [mode, setMode] = useState<Mode>("cpu");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");

  // “Your side”
  const [humanColor, setHumanColor] = useState<PlayerColor>("w");
  const [colorChoice, setColorChoice] = useState<"white" | "black" | "random">("white");

  // Orientation of the board (what user sees at bottom)
  const [orientation, setOrientation] = useState<"white" | "black">("white");

  // Selection + highlights
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalToSquares, setLegalToSquares] = useState<Set<Square>>(new Set());

  const fen = useMemo(() => game.fen(), [game]);

  function safeGameMutate(fn: (g: Chess) => void) {
    setGame((prev) => {
      const next = new Chess(prev.fen());
      fn(next);
      return next;
    });
  }

  function clearSelection() {
    setSelected(null);
    setLegalToSquares(new Set());
  }

  function computeLegalTargets(from: Square, g: Chess) {
    const moves = g.moves({ square: from, verbose: true }) as Move[];
    return new Set(moves.map((m) => m.to as Square));
  }

  function isHumanTurn(g: Chess) {
    // In friend mode, both are human (local). In cpu mode, only humanColor is controlled by user.
    if (mode === "friend") return true;
    return g.turn() === humanColor;
  }

  function tryMove(from: Square, to: Square) {
    try {
      let ok = false;

      safeGameMutate((g) => {
        const piece = g.get(from);
        if (!piece) {
          ok = false;
          return;
        }

        // Turn enforcement:
        // - In friend mode: must move the side to play
        // - In cpu mode: must be human’s turn AND moving the correct side
        if (piece.color !== g.turn()) {
          ok = false;
          return;
        }
        if (mode === "cpu" && g.turn() !== humanColor) {
          ok = false;
          return;
        }

        const move = g.move({ from, to, promotion: "q" });
        ok = !!move;
      });

      return ok;
    } catch {
      return false;
    }
  }

  // Drag-drop support
  function onDrop(sourceSquare: string, targetSquare: string) {
    const from = sourceSquare as Square;
    const to = targetSquare as Square;

    const ok = tryMove(from, to);
    clearSelection();
    return ok;
  }

  // Click-to-highlight + click-to-move
  function onPieceClick(piece: string, square: string) {
    const sq = square as Square;

    try {
      const g = new Chess(game.fen());
      const p = g.get(sq);

      // If clicking empty/invalid, reset
      if (!p) {
        clearSelection();
        return;
      }

      // Enforce: can only select movable pieces (turn + mode rules)
      if (p.color !== g.turn()) {
        clearSelection();
        return;
      }
      if (mode === "cpu" && g.turn() !== humanColor) {
        clearSelection();
        return;
      }

      setSelected(sq);
      setLegalToSquares(computeLegalTargets(sq, g));
    } catch {
      clearSelection();
    }
  }

  function onSquareClick(square: string) {
    const target = square as Square;

    // If we have a selected piece and target is legal, move
    if (selected && legalToSquares.has(target)) {
      const ok = tryMove(selected, target);
      clearSelection();
      return ok;
    }

    // Otherwise, clicking elsewhere clears selection
    clearSelection();
    return false;
  }

  // Highlight squares
  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (selected) {
      styles[selected] = {
        outline: "2px solid rgba(255,255,255,0.65)",
        outlineOffset: "-2px",
      };
    }

    for (const sq of legalToSquares) {
      styles[sq] = {
        boxShadow: "inset 0 0 0 3px rgba(0, 200, 255, 0.35)",
        borderRadius: "6px",
      };
    }

    return styles;
  }, [selected, legalToSquares]);

  // Start / reset game with settings
  function newGame() {
    const g = new Chess();

    // Decide humanColor based on choice
    let hc: PlayerColor = "w";
    if (colorChoice === "white") hc = "w";
    if (colorChoice === "black") hc = "b";
    if (colorChoice === "random") hc = Math.random() < 0.5 ? "w" : "b";

    setHumanColor(hc);
    setOrientation(hc === "w" ? "white" : "black");
    setGame(g);
    clearSelection();
  }

  // CPU auto-move when it’s CPU’s turn
  useEffect(() => {
    if (mode !== "cpu") return;

    const g = new Chess(game.fen());
    const cpuTurn = g.turn() !== humanColor;

    if (!cpuTurn) return;
    if (g.isGameOver()) return;

    const t = setTimeout(() => {
      try {
        const g2 = new Chess(game.fen());
        const move = chooseCpuMove(g2, difficulty);
        if (!move) return;

        safeGameMutate((mut) => {
          mut.move(move);
        });
        clearSelection();
      } catch {
        // ignore
      }
    }, 350);

    return () => clearTimeout(t);
  }, [game, mode, humanColor, difficulty]);

  // If user switches mode/settings, we usually want a clean reset
  useEffect(() => {
    newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const statusText = useMemo(() => {
    const g = new Chess(game.fen());
    if (g.isCheckmate()) return "Checkmate";
    if (g.isStalemate()) return "Stalemate";
    if (g.isDraw()) return "Draw";
    if (g.isCheck()) return "Check";
    return "In play";
  }, [game]);

  const turnText = useMemo(() => (game.turn() === "w" ? "White" : "Black"), [game]);

  return (
    <main className="min-h-screen bg-black text-white p-6 flex items-center justify-center">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">PaperLink Play</h1>
            <p className="text-white/60 text-sm">Chess MVP</p>
            <p className="text-xs text-white/30">build: chessboard-v2</p>
          </div>

          <button
            onClick={newGame}
            className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium"
          >
            New game
          </button>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-white/10 p-4 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setMode("cpu")}
              className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
                mode === "cpu" ? "bg-white text-black border-white" : "border-white/15 text-white/80"
              }`}
            >
              vs CPU
            </button>
            <button
              onClick={() => setMode("friend")}
              className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
                mode === "friend"
                  ? "bg-white text-black border-white"
                  : "border-white/15 text-white/80"
              }`}
              title="Local pass-and-play for now. Online friend play comes next."
            >
              vs Friend
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-white/60">
              Your color
              <select
                value={colorChoice}
                onChange={(e) => setColorChoice(e.target.value as any)}
                className="mt-1 w-full rounded-xl bg-black border border-white/15 px-3 py-2 text-sm text-white"
              >
                <option value="white">White</option>
                <option value="black">Black</option>
                <option value="random">Random</option>
              </select>
            </label>

            <label className="text-xs text-white/60">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                disabled={mode !== "cpu"}
                className="mt-1 w-full rounded-xl bg-black border border-white/15 px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>

          <p className="text-xs text-white/40">
            Tip: tap a piece to highlight legal moves, then tap a square to move.
          </p>
        </div>

        {/* Board */}
        <div className="rounded-2xl overflow-hidden border border-white/10">
          <Chessboard
            position={fen}
            onPieceDrop={onDrop}
            onPieceClick={onPieceClick}
            onSquareClick={onSquareClick}
            customSquareStyles={customSquareStyles}
            boardOrientation={orientation}
          />
        </div>

        {/* Status */}
        <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/70 space-y-1">
          <div>
            <span className="text-white/50">Turn:</span> {turnText}
          </div>
          <div>
            <span className="text-white/50">Status:</span> {statusText}
          </div>
          <div>
            <span className="text-white/50">Mode:</span>{" "}
            {mode === "cpu" ? `CPU (${difficulty})` : "Friend (local pass-and-play)"}
          </div>
          <div className="text-xs text-white/40 pt-2">
            Next: online friend play + game links + matchmaking.
          </div>
        </div>
      </div>
    </main>
  );
}