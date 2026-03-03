"use client";

import React from "react";

type PromotionPiece = "q" | "r" | "b" | "n";

export function PromotionSheet({
  open,
  sideLabel,
  onPick,
  onClose,
}: {
  open: boolean;
  sideLabel: string;
  onPick: (p: PromotionPiece) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const Btn = ({
    label,
    piece,
  }: {
    label: string;
    piece: PromotionPiece;
  }) => (
    <button
      type="button"
      onClick={() => onPick(piece)}
      style={{
        width: "100%",
        padding: "14px 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,.14)",
        background: "rgba(255,255,255,.06)",
        color: "white",
        fontSize: 16,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.55)",
          zIndex: 50,
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 51,
          padding: 14,
          paddingBottom: 18,
          background: "rgba(18,18,18,.96)",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          borderTop: "1px solid rgba(255,255,255,.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
            gap: 12,
          }}
        >
          <div style={{ color: "white", fontWeight: 700, fontSize: 16 }}>
            Promote pawn ({sideLabel})
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(255,255,255,.06)",
              color: "white",
              fontWeight: 700,
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <Btn label="Queen" piece="q" />
          <Btn label="Rook" piece="r" />
          <Btn label="Bishop" piece="b" />
          <Btn label="Knight" piece="n" />
        </div>

        <div style={{ marginTop: 10, color: "rgba(255,255,255,.6)", fontSize: 12 }}>
          Pick the piece you want. (Default queen is not forced anymore.)
        </div>
      </div>
    </>
  );
}