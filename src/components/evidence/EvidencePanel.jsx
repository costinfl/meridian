import React from "react";
import { C } from "../../theme.js";

// Evidence layer entry point. Empty in Phase 1; later phases add the library, runs, review and search.
// Loaded lazily from App.jsx so it adds nothing to the main bundle while the flag is off.
export default function EvidencePanel({ onClose }) {
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(25,32,28,.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Evidence"
        style={{ background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 4, padding: 18, width: 460, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}
      >
        <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink, marginBottom: 8 }}>Evidence (preview)</div>
        <div style={{ font: "400 12px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 }}>
          The evidence layer is under construction. Nothing here changes your project yet.
        </div>
        <div style={{ marginTop: 14, textAlign: "right" }}>
          <button onClick={onClose} style={{ font: "600 12px Archivo, sans-serif", color: C.ink, background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 3, padding: "5px 10px", cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
