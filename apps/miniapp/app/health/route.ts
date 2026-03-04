export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    service: "paperlink-play-miniapp",
    ts: new Date().toISOString(),
  });
}