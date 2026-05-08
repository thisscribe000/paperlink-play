import { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { query } from "../db";
import { Chess } from "chess.js";

interface RoomClient {
  socket: any;
  roomId: string;
  userId?: string;
}

const rooms = new Map<string, Set<RoomClient>>();

export async function wsRoutes(app: FastifyInstance) {
  app.get("/v1/ws", { websocket: true } as any, (connection: any, req: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get("roomId");
    const userId = url.searchParams.get("userId") || undefined;

    if (!roomId) {
      connection.socket.close(1008, "roomId required");
      return;
    }

    const client: RoomClient = { socket: connection.socket, roomId, userId };

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId)!.add(client);

    connection.socket.on("close", () => {
      const roomClients = rooms.get(roomId);
      if (roomClients) {
        roomClients.delete(client);
        if (roomClients.size === 0) {
          rooms.delete(roomId);
        }
      }
    });

    connection.socket.on("message", async (message: any) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "move") {
          const result = await handleMove(roomId, data);
          broadcastRoom(roomId, { type: "gameUpdate", ...result });
        } else if (data.type === "resign") {
          const result = await handleResign(roomId, data.userId);
          broadcastRoom(roomId, { type: "gameUpdate", ...result });
        } else if (data.type === "draw_offer") {
          const result = await handleDrawOffer(roomId, data.userId);
          broadcastRoom(roomId, { type: "gameUpdate", ...result });
        } else if (data.type === "draw_accept") {
          const result = await handleDrawAccept(roomId, data.userId);
          broadcastRoom(roomId, { type: "gameUpdate", ...result });
        }
      } catch (e) {
        console.error("WS message error:", e);
      }
    });
  });
}

function broadcastRoom(roomId: string, message: object) {
  const roomClients = rooms.get(roomId);
  if (!roomClients) return;

  const msg = JSON.stringify(message);
  for (const client of roomClients) {
    if (client.socket.readyState === 1) {
      client.socket.send(msg);
    }
  }
}

async function handleMove(roomId: string, data: {
  from: string;
  to: string;
  promotion?: string;
  userId: string;
}) {
  const res = await query(
    `SELECT id, status, fen, pgn, white_user, black_user FROM rooms WHERE id = $1`,
    [roomId]
  );

  if (res.rowCount === 0) return { error: "room not found" };

  const room = res.rows[0];
  if (room.status === "ended") return { error: "game ended" };

  const chess = new Chess(room.fen);

  let playerColor: "w" | "b" | null = null;
  if (room.white_user === data.userId) playerColor = "w";
  if (room.black_user === data.userId) playerColor = "b";
  if (!playerColor) return { error: "not a player" };

  if (chess.turn() !== playerColor) return { error: "not your turn" };

  const move = chess.move({
    from: data.from,
    to: data.to,
    promotion: data.promotion || "q",
  });

  if (!move) return { error: "illegal move" };

  const fen = chess.fen();
  const pgn = chess.pgn();

  let status = room.status;
  let result = null;

  if (chess.isGameOver()) {
    status = "ended";
    if (chess.isCheckmate()) {
      result = { type: "checkmate", winner: chess.turn() === "w" ? "b" : "w" };
    } else if (chess.isStalemate()) {
      result = { type: "stalemate" };
    } else if (chess.isDraw()) {
      result = { type: "draw" };
    }
  }

  await query(
    `UPDATE rooms SET fen = $2, pgn = $3, status = $4, updated_at = NOW() WHERE id = $1`,
    [roomId, fen, pgn, status]
  );

  return { ok: true, fen, pgn, status, result, inCheck: chess.isCheck() };
}

async function handleResign(roomId: string, userId: string) {
  const res = await query(
    `SELECT id, status, white_user, black_user FROM rooms WHERE id = $1`,
    [roomId]
  );

  if (res.rowCount === 0) return { error: "room not found" };
  const room = res.rows[0];
  if (room.status === "ended") return { error: "game already ended" };

  let winner: "w" | "b" | null = null;
  if (room.white_user === userId) winner = "b";
  if (room.black_user === userId) winner = "w";
  if (!winner) return { error: "not a player" };

  await query(`UPDATE rooms SET status = 'ended', updated_at = NOW() WHERE id = $1`, [roomId]);

  return { ok: true, status: "ended", winner, reason: "resigned" };
}

async function handleDrawOffer(roomId: string, userId: string) {
  const res = await query(
    `SELECT id, status, draw_offered_by, white_user, black_user FROM rooms WHERE id = $1`,
    [roomId]
  );

  if (res.rowCount === 0) return { error: "room not found" };
  const room = res.rows[0];
  if (room.status === "ended") return { error: "game already ended" };

  let playerColor: "w" | "b" | null = null;
  if (room.white_user === userId) playerColor = "w";
  if (room.black_user === userId) playerColor = "b";
  if (!playerColor) return { error: "not a player" };

  if (room.draw_offered_by && room.draw_offered_by !== userId) {
    return { error: "draw already offered" };
  }

  await query(`UPDATE rooms SET draw_offered_by = $2, updated_at = NOW() WHERE id = $1`, [
    roomId,
    userId,
  ]);

  return { ok: true, drawOfferedBy: playerColor };
}

async function handleDrawAccept(roomId: string, userId: string) {
  const res = await query(
    `SELECT id, status, draw_offered_by FROM rooms WHERE id = $1`,
    [roomId]
  );

  if (res.rowCount === 0) return { error: "room not found" };
  const room = res.rows[0];
  if (room.status === "ended") return { error: "game already ended" };
  if (!room.draw_offered_by) return { error: "no draw offer" };
  if (room.draw_offered_by === userId) return { error: "cannot accept your own offer" };

  await query(`UPDATE rooms SET status = 'ended', draw_offered_by = NULL, updated_at = NOW() WHERE id = $1`, [roomId]);

  return { ok: true, status: "ended", result: { type: "draw" } };
}