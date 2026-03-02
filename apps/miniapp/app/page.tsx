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
  return (m.flags || "").includes("c") || (m.flags || "").includes("e");
}

function materialScore(chess: Chess) {
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

  if (difficulty === "easy") return randomItem(moves) ?? null;

  if (difficulty === "medium") {
    const captures = moves.filter(isCapture);
    return (randomItem(captures.length ? captures : moves) ?? null);
  }

  // hard: 1-ply material lookahead
  const cpuColor = chess.turn();
  let best: { move: Move; score: number } | null = null;

  for (const m of moves) {
    const copy = new Chess(chess.fen());
    copy.move(m);

    const s = materialScore(copy);
    const objective = cpuColor === "w" ? s : -s;

    if (!best || objective > best.score) best = { move: m, score: objective };
  }

  return best?.move ?? null;
}

function statusLabel(g: Chess) {
  if (g.isCheckmate()) return "Checkmate";
  if (g.isStalemate()) return "Stalemate";
  if (g.isDraw()) return "Draw";
  if (g.isCheck()) return "Check";
  return "In play";
}

function winnerLabelIfAny(g: Chess) {
  if (!g.isCheckmate()) return null;
  const loser = g.turn();
  const winner = loser === "w" ? "Black" : "White";
  return winner;
}

export default function Home() {
  const [game, setGame] = useState(() => new Chess());

  // Settings
  const [mode, setMode] = useState<Mode>("cpu");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [humanColor, setHumanColor] = useState<PlayerColor>("w");
  const [colorChoice, setColorChoice] = useState<"white" | "black" | "random">("white");
  const [orientation, setOrientation] = useState<"white" | "black">("white");

  // Selection + highlights
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalToSquares, setLegalToSquares] = useState<Set<Square>>(new Set());

  // Scoreboard (session-local)
  const [score, setScore] = useState({ white: 0, black: 0, draws: 0 });
  const [lastCountedFen, setLastCountedFen] = useState<string>("");

  const fen = useMemo(() => game.fen(), [game]);

  function clearSelection() {
    setSelected(null);
    setLegalToSquares(new Set());
  }

  function computeLegalTargets(from: Square, g: Chess) {
    const moves = g.moves({ square: from, verbose: true }) as Move[];
    return new Set(moves.map((m) => m.to as Square));
  }

  // Safe mutate: never throw out of handlers
  function safeGameMutate(fn: (g: Chess) => boolean | void): boolean {
    let ok = false;

    setGame((prev) => {
      const next = new Chess(prev.fen());
      try {
        const result = fn(next);
        ok = result === undefined ? ok : !!result;
      } catch {
        ok = false;
      }
      return next;
    });

    return ok;
  }

  function newGame() {
    const g = new Chess();

    let hc: PlayerColor = "w";
    if (colorChoice === "white") hc = "w";
    if (colorChoice === "black") hc = "b";
    if (colorChoice === "random") hc = Math.random() < 0.5 ? "w" : "b";

    setHumanColor(hc);
    setOrientation(hc === "w" ? "white" : "black");
    setGame(g);
    clearSelection();
    // reset lastCountedFen so a new terminal position counts
    setLastCountedFen("");
  }

  function tryMove(from: Square, to: Square) {
    return safeGameMutate((g) => {
      if (g.isGameOver()) return false;

      const piece = g.get(from);
      if (!piece) return false;

      // Must be side to move
      if (piece.color !== g.turn()) return false;

      // In CPU mode, only allow user to move their color
      if (mode === "cpu" && g.turn() !== humanColor) return false;

      // chess.js rejects illegal moves & enforces "must respond to check"
      const move = g.move({ from, to, promotion: "q" });
      return !!move;
    });
  }

  // Drag-drop support
  function onDrop(sourceSquare: string, targetSquare: string) {
    try {
      const ok = tryMove(sourceSquare as Square, targetSquare as Square);
      clearSelection();
      return ok;
    } catch {
      clearSelection();
      return false;
    }
  }

  // Reliable tap-to-highlight: use onSquareClick (works best in Telegram)
  function onSquareClick(square: string) {
    try {
      const sq = square as Square;
      const g = new Chess(game.fen());

      if (g.isGameOver()) {
        clearSelection();
        return false;
      }

      // If selecting a destination for an already-selected piece
      if (selected && legalToSquares.has(sq)) {
        const ok = tryMove(selected, sq);
        clearSelection();
        return ok;
      }

      // Otherwise treat click as selecting a piece (if valid)
      const p = g.get(sq);
      if (!p) {
        clearSelection();
        return false;
      }

      // Must be correct turn
      if (p.color !== g.turn()) {
        clearSelection();
        return false;
      }

      // In CPU mode, only allow selecting your pieces on your turn
      if (mode === "cpu" && g.turn() !== humanColor) {
        clearSelection();
        return false;
      }

      setSelected(sq);
      setLegalToSquares(computeLegalTargets(sq, g));
      return true;
    } catch {
      clearSelection();
      return false;
    }
  }

  // Optional: keep onPieceClick too, but it’s not required anymore
  function onPieceClick(_piece: string, square: string) {
    // Just forward to onSquareClick for consistency
    return onSquareClick(square);
  }

  // Stronger highlight styles
  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (selected) {
      styles[selected] = {
        outline: "3px solid rgba(255,255,255,0.7)",
        outlineOffset: "-3px",
        backgroundColor: "rgba(255,255,255,0.08)",
      };
    }

    for (const sq of legalToSquares) {
      styles[sq] = {
        backgroundColor: "rgba(0, 200, 255, 0.20)",
        boxShadow: "inset 0 0 0 3px rgba(0, 200, 255, 0.45)",
        borderRadius: "6px",
      };
    }

    return styles;
  }, [selected, legalToSquares]);

  const turnText = useMemo(() => (game.turn() === "w" ? "White" : "Black"), [game]);

  const statusText = useMemo(() => {
    const g = new Chess(game.fen());
    return statusLabel(g);
  }, [game]);

  const winnerText = useMemo(() => {
    const g = new Chess(game.fen());
    return winnerLabelIfAny(g);
  }, [game]);

  const gameOver = useMemo(() => {
    const g = new Chess(game.fen());
    return g.isGameOver();
  }, [game]);

  // Score update once per terminal position
  useEffect(() => {
    const g = new Chess(game.fen());
    if (!g.isGameOver()) return;

    const terminalFen = g.fen();
    if (terminalFen === lastCountedFen) return;

    const winner = winnerLabelIfAny(g);
    if (winner === "White") setScore((s) => ({ ...s, white: s.white + 1 }));
    else if (winner === "Black") setScore((s) => ({ ...s, black: s.black + 1 }));
    else setScore((s) => ({ ...s, draws: s.draws + 1 }));

    setLastCountedFen(terminalFen);
  }, [game, lastCountedFen]);

  // CPU auto-move
  useEffect(() => {
    if (mode !== "cpu") return;

    const g = new Chess(game.fen());
    if (g.isGameOver()) return;

    const cpuTurn = g.turn() !== humanColor;
    if (!cpuTurn) return;

    const t = setTimeout(() => {
      try {
        const g2 = new Chess(game.fen());
        if (g2.isGameOver()) return;

        const move = chooseCpuMove(g2, difficulty);
        if (!move) return;

        safeGameMutate((mut) => {
          if (mut.isGameOver()) return false;
          mut.move(move);
          return true;
        });

        clearSelection();
      } catch {
        // ignore
      }
    }, 350);

    return () => clearTimeout(t);
  }, [game, mode, humanColor, difficulty]);

  // Predictable: reset when switching mode
  useEffect(() => {
    newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Loud status pill classes
  const statusClass =
    statusText === "Checkmate"
      ? "text-white bg-red-600/80 border border-red-400/40 shadow-[0_0_18px_rgba(255,0,0,0.25)]"
      : statusText === "Check"
      ? "text-white bg-red-500/70 border border-red-300/40 shadow-[0_0_18px_rgba(255,0,0,0.22)]"
      : "text-white/80 bg-white/5 border border-white/10";

  return (
    <main className="min-h-screen bg-black text-white px-4 pt-3 pb-6 overflow-y-auto">
      <div className="w-full max-w-md mx-auto space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">PaperLink Play</h1>
            <p className="text-white/60 text-sm">Chess MVP</p>
            <p className="text-xs text-white/30">build: chessboard-v4</p>
          </div>

          <button
            onClick={newGame}
            className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium"
          >
            New game
          </button>
        </div>

        {/* Scoreboard */}
        <div className="rounded-2xl border border-white/10 p-3 text-sm text-white/75 flex items-center justify-between">
          <div>
            White: <span className="text-white">{score.white}</span>
          </div>
          <div>
            Draws: <span className="text-white">{score.draws}</span>
          </div>
          <div>
            Black: <span className="text-white">{score.black}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-white/10 p-3 space-y-2">
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
                mode === "friend" ? "bg-white text-black border-white" : "border-white/15 text-white/80"
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
            Tap a piece/square to highlight legal moves, then tap a highlighted square to move.
            If you’re in <b>Check</b>, only escape moves highlight.
          </p>
        </div>

        {/* Turn + Loud status pill */}
        <div className="rounded-2xl border border-white/10 p-3 text-sm flex items-center justify-between">
          <div className="text-white/70">
            <span className="text-white/50">Turn:</span> {turnText}
          </div>

          <div className={`px-3 py-1 rounded-full text-sm font-semibold ${statusClass}`}>
            {statusText}
          </div>
        </div>

        {/* Winner banner */}
        {gameOver && (
          <div className="rounded-2xl border border-white/10 p-3 text-sm">
            {winnerText ? (
              <div className="text-white">
                ✅ Game over — <span className="font-semibold">{winnerText}</span> wins.
              </div>
            ) : (
              <div className="text-white">
                ✅ Game over — <span className="font-semibold">Draw</span>.
              </div>
            )}
          </div>
        )}

        {/* Board */}
        <div className="rounded-2xl overflow-hidden border border-white/10">
          <Chessboard
            position={fen}
            onPieceDrop={onDrop}
            onSquareClick={onSquareClick}
            onPieceClick={onPieceClick}
            customSquareStyles={customSquareStyles}
            boardOrientation={orientation}
          />
        </div>

        {/* Footer */}
        <div className="rounded-2xl border border-white/10 p-3 text-xs text-white/50">
          Mode: {mode === "cpu" ? `CPU (${difficulty})` : "Friend (local pass-and-play)"} ·{" "}
          {mode === "cpu" ? `You: ${humanColor === "w" ? "White" : "Black"}` : "Online friend play: next"}
        </div>
      </div>
    </main>
  );
}