"use client";

import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

export default function Home() {
  const [game, setGame] = useState(() => new Chess());

  const fen = useMemo(() => game.fen(), [game]);

  function safeGameMutate(fn: (g: Chess) => void) {
    setGame((prev) => {
      const next = new Chess(prev.fen());
      fn(next);
      return next;
    });
  }

  function onDrop(sourceSquare: string, targetSquare: string) {
    let ok = false;

    safeGameMutate((g) => {
      const move = g.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });
      ok = !!move;
    });

    return ok;
  }

  function newGame() {
    setGame(new Chess());
  }

  return (
    <main className="min-h-screen bg-black text-white p-6 flex items-center justify-center">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">PaperLink Play</h1>
            <p className="text-white/60 text-sm">Chess (local MVP)</p>
          </div>

          <button
            onClick={newGame}
            className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium"
          >
            New game
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden border border-white/10">
          <Chessboard position={fen} onPieceDrop={onDrop} />
        </div>

        <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/70 space-y-1">
          <div>
            <span className="text-white/50">Turn:</span>{" "}
            {game.turn() === "w" ? "White" : "Black"}
          </div>
          <div>
            <span className="text-white/50">Status:</span>{" "}
            {game.isGameOver()
              ? "Game over"
              : game.isCheck()
              ? "Check"
              : "In play"}
          </div>
          <div className="text-xs text-white/30">build: chessboard-v1</div>
            Next: create a real game + invite a friend.
          </div>
        </div>
      </div>
    </main>
  );
}