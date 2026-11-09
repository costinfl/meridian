import React, { useEffect, useMemo, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { getStorageStatus, describeStorage } from "../../storage/persistence.js";
import { createEvidenceLibrary } from "../../evidence/index.js";
import { dryRunLegacyConversion, formatDryRun, convertLegacyFacts, confirmLegacyVerified, countLegacyVerifiedPending } from "../../conclusions/legacyFacts.js";

// Evidence layer entry point (behind the evidenceUi flag, loaded lazily from App.jsx).
// Phase 4: record existing timeline facts as evidence, in two deliberate steps.
export default function EvidencePanel({ onClose, storage, project, onProjectChange }) {
  const [line, setLine] = useState("Checking storage…");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(null); // verified facts waiting for their one-time confirmation
  const library = useMemo(() => (storage ? createEvidenceLibrary(storage) : null), [storage]);
  const report = useMemo(() => (project ? dryRunLegacyConversion(project) : null), [project]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const status = await getStorageStatus();
      let last;
      try { last = await storage?.getSetting("lastBundleExportAt"); } catch { /* ignore */ }
      if (alive) setLine(describeStorage(status, last));
    })();
    return () => { alive = false; };
  }, [storage]);

  useEffect(() => {
    let alive = true;
    if (library && project?.legacyEvidence) {
      countLegacyVerifiedPending({ library, project }).then((n) => { if (alive) setPending(n); }).catch(() => { if (alive) setPending(null); });
    } else setPending(null);
    return () => { alive = false; };
  }, [library, project]);

  const toConvert = report ? Object.values(report.facts).reduce((n, f) => n + f.toConvert, 0) + report.wouldCreate.records : 0;

  const run = async (label, fn) => {
    setBusy(true); setMessage(`${label}…`);
    try { setMessage(await fn()); } catch (err) { console.error("Meridian evidence:", err); setMessage(`Failed: ${err.message}`); }
    setBusy(false);
  };

  const convert = () => run("Converting", async () => {
    const res = await convertLegacyFacts({ library, project, loadBlob: (k) => storage.loadBlob(k), saveBlob: (k, b) => storage.saveBlob(k, b) });
    onProjectChange?.(() => res.project);
    const c = res.created;
    return `Done: ${c.assertions} assertions, ${c.personas} personas, ${c.sourcesLinked} sources linked. Nothing was confirmed.${res.warnings.length ? ` Notes: ${res.warnings.join("; ")}` : ""}`;
  });

  const confirmVerified = () => run("Confirming", async () => {
    const r = await confirmLegacyVerified({ library, project });
    setPending(0);
    return `Confirmed ${r.confirmed} verified facts${r.skipped ? ` (${r.skipped} skipped)` : ""}.`;
  });

  const box = { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.rule}` };
  const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(25,32,28,.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Evidence"
        style={{ background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 4, padding: 18, width: 560, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}
      >
        <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink, marginBottom: 8 }}>Evidence (preview)</div>
        <div style={small}>The evidence layer is under construction. Your timeline is not changed by anything below.</div>

        {report && (
          <div style={box} data-testid="legacy-section">
            <div style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Legacy facts</div>
            <div style={small}>
              Each fact on your timeline can be recorded as evidence: one <em>proposed</em> assertion, cited to the fact's own source
              or to “Legacy Meridian data”. Converting does not confirm anything and does not change your facts.
            </div>
            <pre data-testid="dry-run" style={{ ...small, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, whiteSpace: "pre-wrap", background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 3, padding: 8, margin: "8px 0" }}>{formatDryRun(report)}</pre>
            {report.anomalies.length > 0 && (
              <details style={{ ...small, marginBottom: 8 }}>
                <summary style={{ cursor: "pointer" }}>{report.anomalies.length} anomalies noticed</summary>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{report.anomalies.slice(0, 30).map((a, i) => <li key={i}>{a.kind}: {a.message}</li>)}</ul>
              </details>
            )}
            <button style={btnStyle(false)} disabled={busy || !toConvert} onClick={convert} title="Writes evidence; your timeline facts stay as they are">
              {toConvert ? `Convert ${toConvert} legacy items to evidence` : "Nothing left to convert"}
            </button>

            {project?.legacyEvidence && pending > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={small}>
                  {pending} converted facts are marked <strong>verified</strong>. This one-time step records your earlier verification as
                  decisions (decided by “legacy-verified”). Facts you did not verify stay proposed.
                </div>
                <button style={{ ...btnStyle(true), marginTop: 6 }} disabled={busy} onClick={confirmVerified}>Confirm {pending} verified facts</button>
              </div>
            )}
            {message && <div role="status" style={{ ...small, marginTop: 8, color: C.ink }}>{message}</div>}
          </div>
        )}

        <div data-testid="storage-status" style={{ marginTop: 14, font: "400 11px 'IBM Plex Mono', monospace", color: C.inkSoft, lineHeight: 1.5 }}>{line}</div>
        <div style={{ marginTop: 14, textAlign: "right" }}>
          <button onClick={onClose} style={btnStyle(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
