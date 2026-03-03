import ChessGame from "../components/ChessGame";

export default function Page() {
  return (
    <main style={{ padding: 16, maxWidth: 520, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ color: "white", fontSize: 32, fontWeight: 900, margin: 0 }}>
          PaperLink Play
        </h1>
        <p style={{ color: "rgba(255,255,255,.65)", marginTop: 8, lineHeight: 1.35 }}>
          Quick games inside Telegram. Chess first. More coming.
        </p>
      </div>

      <ChessGame />
    </main>
  );
}