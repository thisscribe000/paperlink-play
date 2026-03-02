"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen bg-black text-white p-6 flex items-center justify-center">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 p-5">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-white/70 text-sm">Tap reset.</p>

        <pre className="text-xs text-white/40 whitespace-pre-wrap break-words">
          {String(error?.message || error)}
        </pre>

        <button
          className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium"
          onClick={() => reset()}
        >
          Reset
        </button>
      </div>
    </main>
  );
}