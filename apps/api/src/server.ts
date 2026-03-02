import Fastify from "fastify";
import * as dotenv from "dotenv";
import { Chess } from "chess.js";
import { randomUUID } from "crypto";

dotenv.config();

const app = Fastify({ logger: true });

type GameState = {
  fen: string;
  pgn: string;
  turn: "w" | "b";
};

const games = new Map<string, GameState>();

// Health check
app.get("/health", async () => {
  return { ok: true };
});

// Create new game
app.post("/game/create", async () => {
  const id = randomUUID();

  const chess = new Chess();

  const state: GameState = {
    fen: chess.fen(),
    pgn: chess.pgn(),
    turn: chess.turn(),
  };

  games.set(id, state);

  return {
    gameId: id,
    ...state,
  };
});

// Get game state
app.get<{
  Params: { id: string };
}>("/game/:id/state", async (req, reply) => {
  const { id } = req.params;

  const state = games.get(id);

  if (!state) {
    return reply.code(404).send({ error: "Game not found" });
  }

  return {
    gameId: id,
    ...state,
  };
});

// Make a move
app.post<{
  Params: { id: string };
  Body: { move: string };
}>("/game/:id/move", async (req, reply) => {
  const { id } = req.params;
  const { move } = req.body;

  const state = games.get(id);

  if (!state) {
    return reply.code(404).send({ error: "Game not found" });
  }

  const chess = new Chess(state.fen);

  const from = move.slice(0, 2);
  const to = move.slice(2, 4);

  const result = chess.move({ from, to, promotion: "q" });

  if (!result) {
    return reply.code(400).send({ error: "Illegal move" });
  }

  const newState: GameState = {
    fen: chess.fen(),
    pgn: chess.pgn(),
    turn: chess.turn(),
  };

  games.set(id, newState);

  return {
    gameId: id,
    ...newState,
  };
});

const start = async () => {
  try {
    await app.listen({
      port: Number(process.env.PORT || 4000),
      host: "0.0.0.0",
    });

    console.log("API running...");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();