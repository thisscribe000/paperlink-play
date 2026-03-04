import { FastifyInstance } from "fastify";
import { Chess } from "chess.js";
import { query } from "../db";
import { freshGameFen, randomCode, randomToken } from "../utils";

type RoomRow = {
  id: string;
  join_code: string;
  status: string;
  fen: string;
  pgn: string;
  white_token: string | null;
  black_token: string | null;
  white_name: string | null;
  black_name: string | null;
  turn: "w" | "b";
  last_move_uci: string | null;
  move_number: number;
  draw_offered_by: "w" | "b" | null;
  winner: "w" | "b" | null;
  updated_at: string;
};

function pickColorFromToken(room: RoomRow, token: string): "w" | "b" | null {
  if (room.white_token && token === room.white_token) return "w";
  if (room.black_token && token === room.black_token) return "b";
  return null;
}

function computeStatus(chess: Chess): { status: string; winner: "w" | "b" | null } {
  // chess.js v1 uses isGameOver/isCheckmate/isDraw/isStalemate etc.
  if (chess.isCheckmate()) {
    // side to move is checkmated, winner is opposite
    const winner = chess.turn() === "w" ? ("b" as const) : ("w" as const);
    return { status: "checkmate", winner };
  }
  if (chess.isStalemate()) return { status: "draw", winner: null };
  if (chess.isDraw()) return { status: "draw", winner: null };
  if (chess.isThreefoldRepetition()) return { status: "draw", winner: null };
  if (chess.isInsufficientMaterial()) return { status: "draw", winner: null };
  return { status: "active", winner: null };
}

export async function roomsRoutes(app: FastifyInstance) {
  // Create a room
  app.post("/rooms", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; preferredColor?: "w" | "b" | "random" };

    const join_code = randomCode(6);
    const tokenA = randomToken();
    const tokenB = randomToken();

    const preferred = body.preferredColor ?? "random";
    const assignWhite = preferred === "random" ? (Math.random() < 0.5) : preferred === "w";

    const white_token = assignWhite ? tokenA : tokenB;
    const black_token = assignWhite ? tokenB : tokenA;

    const fen = freshGameFen();

    const rows = await query<RoomRow>(
      `
      insert into public.rooms
        (join_code, fen, pgn, white_token, black_token, white_name, black_name, turn, status, move_number)
      values
        ($1, $2, '', $3, $4, $5, $6, 'w', 'active', 0)
      returning *
      `,
      [
        join_code,
        fen,
        white_token,
        black_token,
        assignWhite ? (body.name ?? "Player 1") : null,
        assignWhite ? null : (body.name ?? "Player 1"),
      ]
    );

    const room = rows[0];
    return reply.send({
      roomId: room.id,
      joinCode: room.join_code,
      token: tokenA, // creator gets tokenA (we keep which side by comparing token)
      youAre: tokenA === room.white_token ? "w" : "b",
      fen: room.fen,
      invite: {
        joinCode: room.join_code,
      },
    });
  });

  // Join a room (by join code)
  app.post("/rooms/join", async (req, reply) => {
    const body = (req.body ?? {}) as { joinCode?: string; name?: string };

    if (!body.joinCode) return reply.code(400).send({ error: "joinCode missing" });

    const found = await query<RoomRow>(`select * from public.rooms where join_code = $1 limit 1`, [
      body.joinCode.toUpperCase(),
    ]);
    if (!found.length) return reply.code(404).send({ error: "room not found" });

    const room = found[0];
    if (room.status !== "active") {
      return reply.code(409).send({ error: "game not active", status: room.status });
    }

    // Determine if "slot" is already named
    const whiteNamed = !!room.white_name;
    const blackNamed = !!room.black_name;

    // If both named, still allow join as "spectator" later; for now, block.
    if (whiteNamed && blackNamed) {
      return reply.code(409).send({ error: "room full" });
    }

    // assign joiner to the empty side
    const joinerColor: "w" | "b" = whiteNamed ? "b" : "w";
    const joinerToken = joinerColor === "w" ? room.white_token! : room.black_token!;

    // store name
    await query(
      `update public.rooms set white_name = coalesce(white_name, $1), black_name = coalesce(black_name, $2), updated_at = now() where id = $3`,
      [joinerColor === "w" ? body.name ?? "Player 2" : null, joinerColor === "b" ? body.name ?? "Player 2" : null, room.id]
    );

    const updated = await query<RoomRow>(`select * from public.rooms where id = $1`, [room.id]);

    return reply.send({
      roomId: room.id,
      token: joinerToken,
      youAre: joinerColor,
      joinCode: room.join_code,
      fen: updated[0].fen,
    });
  });

  // Get room state
  app.get("/rooms/:roomId", async (req, reply) => {
    const { roomId } = req.params as any;
    const token = (req.query as any)?.token as string | undefined;

    const rows = await query<RoomRow>(`select * from public.rooms where id = $1 limit 1`, [roomId]);
    if (!rows.length) return reply.code(404).send({ error: "room not found" });

    const room = rows[0];
    const youAre = token ? pickColorFromToken(room, token) : null;

    const chess = new Chess(room.fen);

    return reply.send({
      roomId: room.id,
      joinCode: room.join_code,
      status: room.status,
      winner: room.winner,
      fen: room.fen,
      pgn: room.pgn,
      turn: room.turn,
      moveNumber: room.move_number,
      lastMoveUci: room.last_move_uci,
      check: chess.isCheck(),
      drawOfferedBy: room.draw_offered_by,
      players: {
        white: room.white_name ?? "White",
        black: room.black_name ?? "Black",
      },
      youAre,
      updatedAt: room.updated_at,
    });
  });

  // Submit a move
  app.post("/rooms/:roomId/move", async (req, reply) => {
    const { roomId } = req.params as any;
    const body = (req.body ?? {}) as {
      token?: string;
      from?: string;
      to?: string;
      promotion?: "q" | "r" | "b" | "n";
      clientMoveNumber?: number;
    };

    if (!body.token) return reply.code(401).send({ error: "token missing" });
    if (!body.from || !body.to) return reply.code(400).send({ error: "from/to missing" });

    const rows = await query<RoomRow>(`select * from public.rooms where id = $1 limit 1`, [roomId]);
    if (!rows.length) return reply.code(404).send({ error: "room not found" });

    const room = rows[0];
    if (room.status !== "active") return reply.code(409).send({ error: "game not active", status: room.status });

    const youAre = pickColorFromToken(room, body.token);
    if (!youAre) return reply.code(403).send({ error: "invalid token" });

    // prevent moving out of turn
    if (room.turn !== youAre) return reply.code(409).send({ error: "not your turn" });

    // basic race protection (optional)
    if (typeof body.clientMoveNumber === "number" && body.clientMoveNumber !== room.move_number) {
      return reply.code(409).send({ error: "stale client", serverMoveNumber: room.move_number });
    }

    const chess = new Chess(room.fen);

    const move = chess.move({
      from: body.from as any,
      to: body.to as any,
      promotion: body.promotion,
    });

    if (!move) {
      // IMPORTANT: return 200 with ok:false so UI can snap back without "error page"
      return reply.send({ ok: false, reason: "illegal" });
    }

    const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
    const san = move.san;

    const { status, winner } = computeStatus(chess);

    // persist
    const nextFen = chess.fen();
    const nextPgn = chess.pgn();

    const nextMoveNumber = room.move_number + 1;
    const nextTurn = chess.turn() as "w" | "b";

    await query(
      `
      update public.rooms
      set fen = $1,
          pgn = $2,
          turn = $3,
          last_move_uci = $4,
          move_number = $5,
          status = $6,
          winner = $7,
          draw_offered_by = null,
          updated_at = now()
      where id = $8
      `,
      [nextFen, nextPgn, nextTurn, uci, nextMoveNumber, status, winner, room.id]
    );

    await query(
      `
      insert into public.room_moves (room_id, move_number, uci, san, by_color, fen_after)
      values ($1, $2, $3, $4, $5, $6)
      `,
      [room.id, nextMoveNumber, uci, san, youAre, nextFen]
    );

    return reply.send({
      ok: true,
      fen: nextFen,
      pgn: nextPgn,
      moveNumber: nextMoveNumber,
      turn: nextTurn,
      check: chess.isCheck(),
      status,
      winner,
      lastMoveUci: uci,
    });
  });

  // Offer draw
  app.post("/rooms/:roomId/draw/offer", async (req, reply) => {
    const { roomId } = req.params as any;
    const body = (req.body ?? {}) as { token?: string };

    if (!body.token) return reply.code(401).send({ error: "token missing" });

    const rows = await query<RoomRow>(`select * from public.rooms where id = $1 limit 1`, [roomId]);
    if (!rows.length) return reply.code(404).send({ error: "room not found" });
    const room = rows[0];

    const youAre = pickColorFromToken(room, body.token);
    if (!youAre) return reply.code(403).send({ error: "invalid token" });

    if (room.status !== "active") return reply.code(409).send({ error: "game not active", status: room.status });

    await query(`update public.rooms set draw_offered_by = $1, updated_at = now() where id = $2`, [youAre, room.id]);
    return reply.send({ ok: true, offeredBy: youAre });
  });

  // Accept draw
  app.post("/rooms/:roomId/draw/accept", async (req, reply) => {
    const { roomId } = req.params as any;
    const body = (req.body ?? {}) as { token?: string };

    if (!body.token) return reply.code(401).send({ error: "token missing" });

    const rows = await query<RoomRow>(`select * from public.rooms where id = $1 limit 1`, [roomId]);
    if (!rows.length) return reply.code(404).send({ error: "room not found" });
    const room = rows[0];

    const youAre = pickColorFromToken(room, body.token);
    if (!youAre) return reply.code(403).send({ error: "invalid token" });

    if (room.status !== "active") return reply.code(409).send({ error: "game not active", status: room.status });
    if (!room.draw_offered_by) return reply.code(409).send({ error: "no draw offer" });
    if (room.draw_offered_by === youAre) return reply.code(409).send({ error: "cannot accept your own offer" });

    await query(
      `update public.rooms set status='draw', winner=null, draw_offered_by=null, updated_at=now() where id=$1`,
      [room.id]
    );

    return reply.send({ ok: true, status: "draw" });
  });

  // Resign
  app.post("/rooms/:roomId/resign", async (req, reply) => {
    const { roomId } = req.params as any;
    const body = (req.body ?? {}) as { token?: string };

    if (!body.token) return reply.code(401).send({ error: "token missing" });

    const rows = await query<RoomRow>(`select * from public.rooms where id = $1 limit 1`, [roomId]);
    if (!rows.length) return reply.code(404).send({ error: "room not found" });
    const room = rows[0];

    const youAre = pickColorFromToken(room, body.token);
    if (!youAre) return reply.code(403).send({ error: "invalid token" });

    if (room.status !== "active") return reply.code(409).send({ error: "game not active", status: room.status });

    const winner = youAre === "w" ? "b" : "w";

    await query(
      `update public.rooms set status='resigned', winner=$1, updated_at=now() where id=$2`,
      [winner, room.id]
    );

    return reply.send({ ok: true, status: "resigned", winner });
  });
}