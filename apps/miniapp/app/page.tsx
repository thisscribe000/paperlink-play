export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-3xl font-semibold">PaperLink Play</h1>
        <p className="text-white/70">
          Quick games inside Telegram. Chess first. More coming.
        </p>

        <div className="space-y-3">
          <button className="w-full rounded-xl bg-white text-black py-3 font-medium">
            ♟️ Chess (Coming next)
          </button>
          <button className="w-full rounded-xl border border-white/20 py-3 text-white/60">
            🎲 Ludo (Soon)
          </button>
          <button className="w-full rounded-xl border border-white/20 py-3 text-white/60">
            🟡 Connect 4 (Soon)
          </button>
        </div>

        <p className="text-xs text-white/40">
          Tip: Use the bot menu button to reopen anytime.
        </p>
      </div>
    </main>
  );
}