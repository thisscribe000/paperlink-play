export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function apiCreateRoom(input: { name?: string; preferredColor?: "w" | "b" | "random" }) {
  const res = await fetch(`${API_BASE}/v1/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return j<{
    roomId: string;
    joinCode: string;
    token: string;
    youAre: "w" | "b";
    fen: string;
    invite: { joinCode: string };
  }>(res);
}

export async function apiJoinRoom(input: { joinCode: string; name?: string }) {
  const res = await fetch(`${API_BASE}/v1/rooms/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return j<{
    roomId: string;
    joinCode: string;
    token: string;
    youAre: "w" | "b";
    fen: string;
  }>(res);
}

export async function apiGetRoom(roomId: string, token?: string) {
  const url = new URL(`${API_BASE}/v1/rooms/${roomId}`);
  if (token) url.searchParams.set("token", token);
  const res = await fetch(url.toString(), { method: "GET" });
  return j<{
    roomId: string;
    joinCode: string;
    status: string;
    winner: "w" | "b" | null;
    fen: string;
    pgn: string;
    turn: "w" | "b";
    moveNumber: number;
    lastMoveUci: string | null;
    check: boolean;
    drawOfferedBy: "w" | "b" | null;
    players: { white: string; black: string };
    youAre: "w" | "b" | null;
    updatedAt: string;
  }>(res);
}

export async function apiMove(roomId: string, input: {
  token: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
  clientMoveNumber: number;
}) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return j<any>(res);
}

export async function apiResign(roomId: string, token: string) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/resign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return j<any>(res);
}

export async function apiOfferDraw(roomId: string, token: string) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/draw/offer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return j<any>(res);
}

export async function apiAcceptDraw(roomId: string, token: string) {
  const res = await fetch(`${API_BASE}/v1/rooms/${roomId}/draw/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return j<any>(res);
}