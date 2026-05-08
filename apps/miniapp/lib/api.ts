export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function apiCreateRoom(input: { userId?: string; name?: string }) {
  const res = await fetch(`${API_BASE}/v1/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return j<{
    roomId: string;
    joinCode: string;
    status: string;
    youAre: "w" | "b" | null;
    fen: string;
    pgn: string;
  }>(res);
}

export async function apiJoinRoom(input: { joinCode: string; userId?: string }) {
  const res = await fetch(`${API_BASE}/v1/rooms/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return j<{
    roomId: string;
    joinCode: string;
    status: string;
    youAre: "w" | "b";
    fen: string;
    pgn: string;
  }>(res);
}

export async function apiGetRoom(roomIdOrCode: string, userId?: string) {
  const url = new URL(`${API_BASE}/v1/rooms/${roomIdOrCode}`);
  if (userId) url.searchParams.set("userId", userId);
  const res = await fetch(url.toString(), { method: "GET" });
  return j<{
    id: string;
    join_code: string;
    status: string;
    fen: string;
    pgn: string;
    white_user: string;
    black_user: string;
    draw_offered_by: string | null;
  }>(res);
}

export async function apiMove(roomId: string, input: {
  userId: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return j<any>(res);
}

export async function apiResign(roomId: string, userId: string) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/resign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return j<any>(res);
}

export async function apiOfferDraw(roomId: string, userId: string) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/draw/offer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return j<any>(res);
}

export async function apiAcceptDraw(roomId: string, userId: string) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/draw/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return j<any>(res);
}