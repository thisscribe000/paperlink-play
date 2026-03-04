"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

type Mode = "cpu" | "friend_offline" | "friend_online";
type Color = "white" | "black";
type Difficulty = "easy" | "medium" | "hard";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function randId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clampPromotion(p?: string) {
  if (p === "q" || p === "r" || p === "b" || p === "n") return p;
  return "q";
}

export default function ChessGame() {
  const [mode, setMode] = useState<Mode>("cpu");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [yourColor, setYourColor] = useState<Color>("white");

  // online
  const [roomCode, setRoomCode] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [playerId, setPlayerId] = useState<string>("");
  const [onlineColor, setOnlineColor] = useState<Color | "spectator">("spectator");
  const [onlineStatus, setOnlineStatus] = useState<string>("idle");
  const pollingRef = useRef<any>(null);

  // chess state
  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState(chessRef.current.fen());
  const [pgn, setPgn] = useState("");
  const [statusLabel, setStatusLabel] = useState<string>("");
  const [turnLabel, setTurnLabel] = useState<string>("White");

  // ui helpers
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<Record<string, any>>({});
  const [promo, setPromo] = useState<"q" | "r" | "b" | "n">("q");

  // store a stable playerId locally
  useEffect(() => {
    const existing = localStorage.getItem("plp_player_id");
    const id = existing || randId();
    if (!existing) localStorage.setItem("plp_player_id", id);
    setPlayerId(id);
  }, []);

  const canMoveLocal = useMemo(() => {
    const chess = chessRef.current;
    if (mode === "friend_offline") return true;
    if (mode === "cpu") return chess.turn() === (yourColor === "white" ? "w" : "b");
    if (mode === "friend_online") {
      if (onlineColor === "spectator") return false;
      return chess.turn() === (onlineColor === "white" ? "w" : "b");
    }
    return false;
  }, [mode, yourColor, onlineColor, fen]);

  function refreshLabels() {
    const chess = chessRef.current;
    const turn = chess.turn() === "w" ? "White" : "Black";
    setTurnLabel(turn);

    if (chess.isCheckmate()) {
      const winner = chess.turn() === "w" ? "Black" : "White";
      setStatusLabel(`Checkmate — ${winner} wins.`);
      return;
    }
    if (chess.isStalemate()) {
      setStatusLabel("Stalemate — Draw.");
      return;
    }
    if (chess.isDraw()) {
      setStatusLabel("Draw.");
      return;
    }
    if (chess.isCheck()) {
      setStatusLabel("CHECK");
      return;
    }
    setStatusLabel("");
  }

  function resetGame(startAs: Color = "white") {
    chessRef.current = new Chess();
    setFen(chessRef.current.fen());
    setPgn("");
    setSelectedSquare(null);
    setLegalTargets({});
    setPromo("q");
    refreshLabels();

    if (mode === "cpu") setYourColor(startAs);
  }

  // initial labels
  useEffect(() => {
    refreshLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // recompute legal moves highlights
  function computeLegalTargets(square: string) {
    const chess = chessRef.current;
    const moves = chess.moves({ square, verbose: true }) as any[];
    const map: Record<string, any> = {};
    for (const m of moves) map[m.to] = { background: "rgba(255,255,255,0.35)" };
    return map;
  }

  function clearSelection() {
    setSelectedSquare(null);
    setLegalTargets({});
  }

  // CPU move (simple)
  async function maybeCpuMove() {
    if (mode !== "cpu") return;
    const chess = chessRef.current;
    const cpuColor = yourColor === "white" ? "black" : "white";
    const cpuTurn = chess.turn() === (cpuColor === "white" ? "w" : "b");
    if (!cpuTurn) return;

    const moves = chess.moves({ verbose: true }) as any[];
    if (moves.length === 0) return;

    let choice = moves[Math.floor(Math.random() * moves.length)];
    if (difficulty === "medium") {
      // prefer captures slightly
      const caps = moves.filter((m) => m.captured);
      if (caps.length) choice = caps[Math.floor(Math.random() * caps.length)];
    }
    if (difficulty === "hard") {
      // prefer captures/forcing moves more often
      const caps = moves.filter((m) => m.captured || m.san.includes("+"));
      if (caps.length) choice = caps[Math.floor(Math.random() * caps.length)];
    }

    chess.move(choice);
    setFen(chess.fen());
    setPgn(chess.pgn());
    refreshLabels();
    clearSelection();
  }

  useEffect(() => {
    if (mode === "cpu") {
      const t = setTimeout(() => void maybeCpuMove(), 350);
      return () => clearTimeout(t);
    }
  }, [fen, mode, yourColor, difficulty]);

  // ONLINE: poll server room state
  async function pollRoom(code: string) {
    if (!API_URL) return;
    const res = await fetch(`${API_URL}/rooms/${code}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();

    // keep local chess in sync with server fen/pgn
    if (data.fen && data.fen !== chessRef.current.fen()) {
      chessRef.current = new Chess(data.fen);
      setFen(data.fen);
      setPgn(data.pgn || "");
      refreshLabels();
      clearSelection();
    }

    if (data.status && data.status !== "playing") {
      if (data.status === "checkmate") {
        setStatusLabel(`Checkmate — ${data.winner === "white" ? "White" : "Black"} wins.`);
      } else if (data.status === "resigned") {
        setStatusLabel(`${data.winner === "white" ? "White" : "Black"} wins (resignation).`);
      } else if (data.status === "draw") {
        setStatusLabel("Draw.");
      }
    } else {
      // still playing: server inCheck info is nice but we also compute locally
      refreshLabels();
    }
  }

  function startPolling(code: string) {
    stopPolling();
    pollingRef.current = setInterval(() => void pollRoom(code), 1000);
  }

  function stopPolling() {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
  }

  useEffect(() => () => stopPolling(), []);

  // create / join room
  async function createOnlineRoom() {
    if (!API_URL) {
      setOnlineStatus("Set NEXT_PUBLIC_API_URL first.");
      return;
    }
    setOnlineStatus("Creating room...");
    const res = await fetch(`${API_URL}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!res.ok) {
      setOnlineStatus("Failed to create room.");
      return;
    }
    const data = await res.json();
    setRoomCode(data.code);
    setOnlineColor("white");
    setOnlineStatus(`Room created: ${data.code} (you are White)`);
    chessRef.current = new Chess();
    setFen(chessRef.current.fen());
    setPgn("");
    refreshLabels();
    clearSelection();
    startPolling(data.code);
  }

  async function joinOnlineRoom(codeRaw: string) {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;
    if (!API_URL) {
      setOnlineStatus("Set NEXT_PUBLIC_API_URL first.");
      return;
    }
    setOnlineStatus("Joining room...");
    const res = await fetch(`${API_URL}/rooms/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, playerId }),
    });
    if (!res.ok) {
      setOnlineStatus("Failed to join (room full or missing).");
      return;
    }
    const data = await res.json();
    setRoomCode(code);
    setOnlineColor(data.color || "spectator");
    setOnlineStatus(`Joined: ${code} (${data.color})`);
    chessRef.current = new Chess(data.fen);
    setFen(data.fen);
    setPgn(data.pgn || "");
    refreshLabels();
    clearSelection();
    startPolling(code);
  }

  async function onlineMove(from: string, to: string, promotion?: "q" | "r" | "b" | "n") {
    if (!API_URL || !roomCode) return false;

    const res = await fetch(`${API_URL}/rooms/${roomCode}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, from, to, promotion }),
    });

    if (!res.ok) {
      // illegal or not your turn -> snap back
      return false;
    }

    const data = await res.json();
    chessRef.current = new Chess(data.fen);
    setFen(data.fen);
    setPgn(data.pgn || "");
    refreshLabels();
    clearSelection();
    return true;
  }

  async function resignOnline() {
    if (!API_URL || !roomCode) return;
    await fetch(`${API_URL}/rooms/${roomCode}/resign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await pollRoom(roomCode);
  }

  // chessboard handlers
  function onSquareClick(square: string) {
    if (!canMoveLocal) return;

    // selecting a piece / moving to a target
    if (selectedSquare) {
      if (legalTargets[square]) {
        // attempt move
        const from = selectedSquare;
        const to = square;

        const piece = chessRef.current.get(from as any);
        const isPawn = piece?.type === "p";
        const isPromotion =
          isPawn &&
          ((piece.color === "w" && to.endsWith("8")) || (piece.color === "b" && to.endsWith("1")));

        if (mode === "friend_online") {
          void onlineMove(from, to, isPromotion ? promo : undefined);
        } else {
          const chess = chessRef.current;
          const mv = chess.move({ from, to, promotion: isPromotion ? promo : undefined } as any);
          if (!mv) {
            // illegal -> keep selection but don’t crash
            return;
          }
          setFen(chess.fen());
          setPgn(chess.pgn());
          refreshLabels();
          clearSelection();
        }
        return;
      }

      // clicked elsewhere: clear and reselect
      clearSelection();
    }

    // select new square if it has piece
    const piece = chessRef.current.get(square as any);
    if (!piece) return;

    // enforce color in cpu / online
    if (mode === "cpu") {
      const mustBe = yourColor === "white" ? "w" : "b";
      if (piece.color !== mustBe) return;
    }
    if (mode === "friend_online" && onlineColor !== "spectator") {
      const mustBe = onlineColor === "white" ? "w" : "b";
      if (piece.color !== mustBe) return;
    }

    setSelectedSquare(square);
    setLegalTargets(computeLegalTargets(square));
  }

  function onPieceDrop(from: string, to: string) {
    // This returning false is what makes illegal moves SNAP BACK.
    if (!canMoveLocal) return false;

    const piece = chessRef.current.get(from as any);
    const isPawn = piece?.type === "p";
    const isPromotion =
      isPawn &&
      ((piece.color === "w" && to.endsWith("8")) || (piece.color === "b" && to.endsWith("1")));

    if (mode === "friend_online") {
      // async move, but react-chessboard expects sync boolean.
      // So we only allow drops that are clearly legal from local view,
      // then we sync with server; if server rejects, we’ll snap back by returning false here.
      const moves = chessRef.current.moves({ square: from, verbose: true }) as any[];
      const ok = moves.some((m) => m.to === to);
      if (!ok) return false;

      void onlineMove(from, to, isPromotion ? promo : undefined);
      clearSelection();
      return true;
    }

    const chess = chessRef.current;
    const mv = chess.move({ from, to, promotion: isPromotion ? promo : undefined } as any);
    if (!mv) return false;

    setFen(chess.fen());
    setPgn(chess.pgn());
    refreshLabels();
    clearSelection();
    return true;
  }

  // mode switching behavior
  useEffect(() => {
    clearSelection();
    if (mode !== "friend_online") {
      stopPolling();
      setRoomCode("");
      setOnlineColor("spectator");
      setOnlineStatus("idle");
    }
  }, [mode]);

  // UI
  const checkBadge = statusLabel === "CHECK";

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: "0 auto", color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>PaperLink Play</h1>
      <p style={{ opacity: 0.75, marginBottom: 14 }}>Quick games inside Telegram. Chess first. More coming.</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button
          onClick={() => setMode("cpu")}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: mode === "cpu" ? "white" : "transparent",
            color: mode === "cpu" ? "black" : "white",
            fontWeight: 700,
          }}
        >
          vs CPU
        </button>

        <button
          onClick={() => setMode("friend_offline")}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: mode === "friend_offline" ? "white" : "transparent",
            color: mode === "friend_offline" ? "black" : "white",
            fontWeight: 700,
          }}
        >
          vs Friend (offline)
        </button>

        <button
          onClick={() => setMode("friend_online")}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: mode === "friend_online" ? "white" : "transparent",
            color: mode === "friend_online" ? "black" : "white",
            fontWeight: 700,
          }}
        >
          vs Friend (online)
        </button>
      </div>

      {/* settings */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 12,
          marginBottom: 12,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        {mode === "cpu" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 6 }}>Your color</div>
              <select
                value={yourColor}
                onChange={(e) => {
                  const c = e.target.value as Color;
                  setYourColor(c);
                  resetGame(c);
                }}
                style={{ width: "100%", padding: 10, borderRadius: 12 }}
              >
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </div>

            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 6 }}>Difficulty</div>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                style={{ width: "100%", padding: 10, borderRadius: 12 }}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>
        )}

        {mode === "friend_online" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => void createOnlineRoom()}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "white",
                  color: "black",
                  fontWeight: 800,
                }}
              >
                Create room
              </button>

              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                <input
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  placeholder="Room code"
                  style={{ flex: 1, padding: 10, borderRadius: 12 }}
                />
                <button
                  onClick={() => void joinOnlineRoom(joinCodeInput)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "transparent",
                    color: "white",
                    fontWeight: 800,
                  }}
                >
                  Join
                </button>
              </div>
            </div>

            <div style={{ opacity: 0.85, fontSize: 13 }}>
              {roomCode ? (
                <>
                  Room: <b>{roomCode}</b> · You: <b>{String(onlineColor)}</b>
                </>
              ) : (
                "No room yet."
              )}
            </div>

            <div style={{ opacity: 0.75, fontSize: 12 }}>{onlineStatus}</div>

            {roomCode && (
              <button
                onClick={() => void resignOnline()}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "white",
                  fontWeight: 800,
                }}
              >
                Resign
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 6 }}>Promotion</div>
            <select
              value={promo}
              onChange={(e) => setPromo(clampPromotion(e.target.value) as any)}
              style={{ width: "100%", padding: 10, borderRadius: 12 }}
            >
              <option value="q">Queen</option>
              <option value="r">Rook</option>
              <option value="b">Bishop</option>
              <option value="n">Knight</option>
            </select>
          </div>

          <button
            onClick={() => resetGame(mode === "cpu" ? yourColor : "white")}
            style={{
              flex: 1,
              minWidth: 160,
              padding: 10,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "white",
              fontWeight: 800,
              marginTop: 18,
            }}
          >
            New game
          </button>
        </div>
      </div>

      {/* status bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 12,
          marginBottom: 12,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: 800 }}>Turn: {turnLabel}</div>

        {statusLabel ? (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              fontWeight: 900,
              background: checkBadge ? "rgba(255, 0, 0, 0.7)" : "rgba(255,255,255,0.12)",
            }}
          >
            {statusLabel}
          </div>
        ) : (
          <div style={{ opacity: 0.7, fontSize: 12 }}>Tap to see legal moves.</div>
        )}
      </div>

      {/* board */}
      <div style={{ borderRadius: 18, overflow: "hidden" }}>
        <Chessboard
          position={fen}
          arePiecesDraggable={true}
          onPieceDrop={onPieceDrop}
          onSquareClick={onSquareClick}
          customSquareStyles={{
            ...(selectedSquare ? { [selectedSquare]: { background: "rgba(0,255,255,0.25)" } } : {}),
            ...legalTargets,
          }}
        />
      </div>

      {/* footer */}
      <div style={{ opacity: 0.7, fontSize: 12, marginTop: 10 }}>
        {mode === "cpu" && <>Mode: CPU ({difficulty}) · You: {yourColor}</>}
        {mode === "friend_offline" && <>Mode: Friend (offline)</>}
        {mode === "friend_online" && (
          <>
            Mode: Friend (online) · Room: {roomCode || "—"} · You: {String(onlineColor)}
          </>
        )}
      </div>
    </div>
  );
}