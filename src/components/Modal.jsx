import React from "react";
import { C } from "../theme.js";

export function Modal({ title, children, onClose, width = 380 }) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(25,32,28,.45)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 4,
          padding: 18, width, maxWidth: "92vw",
          boxShadow: "0 12px 40px rgba(20,28,24,.35)",
          maxHeight: "85vh", display: "flex", flexDirection: "column",
        }}
      >
        {title && (
          <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink, marginBottom: 12, flexShrink: 0 }}>
            {title}
          </div>
        )}
        <div style={{ overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}
