import { FastifyInstance } from "fastify";
import { query } from "../db";
import { randomBytes } from "crypto";
import { Chess } from "chess.js";

type Color = "w" | "b";
type RoomStatus = "waiting" | "active" | "ended";

function id16() {
  return randomBytes(8).toString("hex");
}

function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function roomsRoutes(app: FastifyInstance) {
  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      join_code TEXT UNIQUE,
      status TEXT NOT NULL,
      fen TEXT NOT NULL,
      pgn TEXT NOT NULL,
      white_user TEXT,
      black_user TEXT,
      draw_offered_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  app.post("/rooms", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; name?: string };

    let joinCode = generateJoinCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await query(`SELECT id FROM rooms WHERE join_code = $1`, [joinCode]);
      if (existing.rowCount === 0) break;
      joinCode = generateJoinCode();
      attempts++;
    }

    const roomId = id16();
    const chess = new Chess();
    const fen = chess.fen();
    const pgn = chess.pgn();

    await query(
      `INSERT INTO rooms (id, join_code, status, fen, pgn, white_user, black_user)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roomId, joinCode, "waiting", fen, pgn, body.userId ?? null, null]
    );

    return reply.send({
      roomId,
      joinCode,
      status: "waiting",
      fen,
      pgn,
      youAre: body.userId ? "w" : null,
    });
  });

  app.post("/rooms/join", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string; joinCode?: string };

    if (!body.userId) return reply.code(400).send({ error: "userId required" });
    if (!body.joinCode) return reply.code(400).send({ error: "joinCode required" });

    const code = body.joinCode.toUpperCase();

    const res = await query(
      `SELECT id, join_code, status, fen, pgn, white_user, black_user
       FROM rooms WHERE join_code = $1 OR id = $1`,
      [code]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });

    const room = res.rows[0];

    if (room.white_user === body.userId) {
      return reply.send({ roomId: room.id, joinCode: room.join_code, youAre: "w", ...room });
    }
    if (room.black_user === body.userId) {
      return reply.send({ roomId: room.id, joinCode: room.join_code, youAre: "b", ...room });
    }

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

    const newStatus: RoomStatus = white_user && black_user ? "active" : "waiting";

    await query(
      `UPDATE rooms SET white_user = $2, black_user = $3, status = $4, updated_at = NOW() WHERE id = $1`,
      [room.id, white_user, black_user, newStatus]
    );

    return reply.send({
      roomId: room.id,
      joinCode: room.join_code,
      status: newStatus,
      fen: room.fen,
      pgn: room.pgn,
      white_user,
      black_user,
      youAre,
    });
  });

  app.get("/rooms/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const res = await query(
      `SELECT id, join_code, status, fen, pgn, white_user, black_user, draw_offered_by, created_at, updated_at
       FROM rooms WHERE id = $1 OR join_code = $1`,
      [id.toUpperCase()]
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

  app.post("/rooms/:id/resign", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };

    if (!body.userId) return reply.code(400).send({ error: "userId required" });

    const res = await query(
      `SELECT id, status, fen, pgn, white_user, black_user FROM rooms WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });
    const room = res.rows[0];

    if (room.status === "ended") return reply.code(409).send({ error: "game already ended" });

    let winner: Color | null = null;
    if (room.white_user === body.userId) winner = "b";
    if (room.black_user === body.userId) winner = "w";

    if (!winner) return reply.code(403).send({ error: "not a player in this room" });

    await query(
      `UPDATE rooms SET status = 'ended', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    return reply.send({ ok: true, status: "ended", winner, reason: "resigned" });
  });

  app.post("/rooms/:id/draw/offer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };

    if (!body.userId) return reply.code(400).send({ error: "userId required" });

    const res = await query(
      `SELECT id, status, fen, pgn, white_user, black_user, draw_offered_by FROM rooms WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });
    const room = res.rows[0];

    if (room.status === "ended") return reply.code(409).send({ error: "game already ended" });

    let playerColor: Color | null = null;
    if (room.white_user === body.userId) playerColor = "w";
    if (room.black_user === body.userId) playerColor = "b";
    if (!playerColor) return reply.code(403).send({ error: "not a player in this room" });

    if (room.draw_offered_by && room.draw_offered_by !== body.userId) {
      return reply.code(409).send({ error: "draw already offered" });
    }

    await query(
      `UPDATE rooms SET draw_offered_by = $2, updated_at = NOW() WHERE id = $1`,
      [id, body.userId]
    );

    return reply.send({ ok: true, drawOfferedBy: playerColor });
  });

  app.post("/rooms/:id/draw/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };

    if (!body.userId) return reply.code(400).send({ error: "userId required" });

    const res = await query(
      `SELECT id, status, fen, pgn, white_user, black_user, draw_offered_by FROM rooms WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return reply.code(404).send({ error: "room not found" });
    const room = res.rows[0];

    if (room.status === "ended") return reply.code(409).send({ error: "game already ended" });

    if (!room.draw_offered_by) return reply.code(400).send({ error: "no draw offer" });
    if (room.draw_offered_by === body.userId) return reply.code(400).send({ error: "cannot accept your own offer" });

    await query(
      `UPDATE rooms SET status = 'ended', draw_offered_by = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    return reply.send({ ok: true, status: "ended", result: { type: "draw", acceptedBy: body.userId } });
  });
}