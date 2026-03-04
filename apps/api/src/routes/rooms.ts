import { FastifyInstance } from "fastify";
import { query } from "../db";
import { randomBytes } from "crypto";
import { Chess } from "chess.js";

type Color = "w" | "b";
type RoomStatus = "waiting" | "active" | "ended";

function id16() {
  return randomBytes(8).toString("hex");
}

export async function roomsRoutes(app: FastifyInstance) {
  // Create rooms table if missing (simple bootstrap)
  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      fen TEXT NOT NULL,
      pgn TEXT NOT NULL,
      white_user TEXT,
      black_user TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Create a new room
  app.post("/rooms", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string };

    const roomId = id16();
    const chess = new Chess();
    const fen = chess.fen();
    const pgn = chess.pgn();

    await query(
      `INSERT INTO rooms (id, status, fen, pgn, white_user, black_user)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roomId, "waiting", fen, pgn, body.userId ?? null, null]
    );

    return reply.send({
      roomId,
      status: "waiting",
      fen,
      pgn,
      youAre: body.userId ? "w" : null,
    });
  });

  // Join a room (auto-seat if available)
  app.post("/rooms/:id/join", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };

    if (!body.userId) return reply.code(400).send({ error: "userId required" });

    const res = await query(
      `SELECT id, status, fen, pgn, white_user, black_user
       FROM rooms WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });

    const room = res.rows[0];

    // Already seated?
    if (room.white_user === body.userId) {
      return reply.send({ roomId: id, youAre: "w", ...room });
    }
    if (room.black_user === body.userId) {
      return reply.send({ roomId: id, youAre: "b", ...room });
    }

    // Seat them if possible
    let youAre: Color | null = null;
    let white_user = room.white_user as string | null;
    let black_user = room.black_user as string | null;

    if (!white_user) {
      white_user = body.userId;
      youAre = "w";
    } else if (!black_user) {
      black_user = body.userId;
      youAre = "b";
    } else {
      return reply.code(409).send({ error: "room full" });
    }

    const newStatus: RoomStatus =
      white_user && black_user ? "active" : "waiting";

    await query(
      `UPDATE rooms
       SET white_user = $2, black_user = $3, status = $4, updated_at = NOW()
       WHERE id = $1`,
      [id, white_user, black_user, newStatus]
    );

    return reply.send({
      roomId: id,
      status: newStatus,
      fen: room.fen,
      pgn: room.pgn,
      white_user,
      black_user,
      youAre,
    });
  });

  // Get room state
  app.get("/rooms/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const res = await query(
      `SELECT id, status, fen, pgn, white_user, black_user, created_at, updated_at
       FROM rooms WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });

    return reply.send(res.rows[0]);
  });

  // Make a move (server validates)
  app.post("/rooms/:id/move", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      userId?: string;
      from?: string;
      to?: string;
      promotion?: "q" | "r" | "b" | "n";
    };

    if (!body.userId) return reply.code(400).send({ error: "userId required" });
    if (!body.from || !body.to) return reply.code(400).send({ error: "from/to required" });

    const res = await query(
      `SELECT id, status, fen, pgn, white_user, black_user
       FROM rooms WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });
    const room = res.rows[0];

    if (room.status === "ended") {
      return reply.code(409).send({ error: "game ended" });
    }

    // Determine player color
    let playerColor: Color | null = null;
    if (room.white_user === body.userId) playerColor = "w";
    if (room.black_user === body.userId) playerColor = "b";
    if (!playerColor) return reply.code(403).send({ error: "not a player in this room" });

    const chess = new Chess(room.fen);

    if (chess.turn() !== playerColor) {
      return reply.code(409).send({ error: "not your turn" });
    }

    const move = chess.move({
      from: body.from,
      to: body.to,
      promotion: body.promotion ?? "q",
    });

    if (!move) {
      return reply.code(400).send({ error: "illegal move" });
    }

    const fen = chess.fen();
    const pgn = chess.pgn();

    let status: RoomStatus = room.status;
    let result: any = null;

    if (chess.isGameOver()) {
      status = "ended";
      if (chess.isCheckmate()) {
        // If it's checkmate, side to move is checkmated.
        const winner = chess.turn() === "w" ? "b" : "w";
        result = { type: "checkmate", winner };
      } else if (chess.isStalemate()) {
        result = { type: "stalemate" };
      } else if (chess.isDraw()) {
        result = { type: "draw" };
      } else {
        result = { type: "ended" };
      }
    }

    await query(
      `UPDATE rooms
       SET fen = $2, pgn = $3, status = $4, updated_at = NOW()
       WHERE id = $1`,
      [id, fen, pgn, status]
    );

    return reply.send({
      ok: true,
      move,
      fen,
      pgn,
      status,
      inCheck: chess.isCheck(),
      result,
    });
  });
}