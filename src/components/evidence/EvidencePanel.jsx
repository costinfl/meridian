import React, { useEffect, useMemo, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { getStorageStatus, describeStorage } from "../../storage/persistence.js";
import { createEvidenceLibrary } from "../../evidence/index.js";
import { dryRunLegacyConversion, formatDryRun, convertLegacyFacts, confirmLegacyVerified, countLegacyVerifiedPending, LEGACY_METHOD } from "../../conclusions/legacyFacts.js";
import { currentLinks, decideLink } from "../../conclusions/personaLinks.js";
import { displayName } from "../../models/project.js";

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

  // legacy personas wait as candidate links until the researcher accepts each one
  const candidates = useMemo(() => (project ? currentLinks(project).filter((l) => l.method === LEGACY_METHOD && l.status === "candidate") : []), [project]);
  const acceptLink = (link) => {
    onProjectChange?.((p) => decideLink(p, link.id, "accepted", { decidedBy: "user" }).project);
    setMessage("Link accepted.");
  };

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
    return `Done: ${c.assertions} assertions, ${c.personas} personas, ${c.sourcesLinked} sources linked. Nothing was confirmed or accepted.${res.warnings.length ? ` Notes: ${res.warnings.join("; ")}` : ""}`;
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
              Each fact on your timeline can be recorded as evidence: <em>proposed</em> assertions (a birth or death gives one for
              the date and one for the place), cited to the fact's own source or to “Legacy Meridian data”. Converting does not
              confirm anything and does not change your facts.
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
            {candidates.length > 0 && (
              <div style={{ marginTop: 12 }} data-testid="legacy-links">
                <div style={small}>
                  {candidates.length} people have a legacy record waiting to be linked. Accepting a link states that the record
                  made from a person's old timeline data is that person. Each one is accepted separately.
                </div>
                <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 150, overflowY: "auto" }}>
                  {candidates.map((l) => {
                    const person = (project.people ?? []).find((p) => p.id === l.personId);
                    const name = displayName(person) || "Unnamed";
                    return (
                      <li key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 0", font: "500 12px Archivo, sans-serif", color: C.ink }}>
                        <span>{name}</span>
                        <button style={{ ...btnStyle(false), padding: "2px 8px", fontSize: 11 }} disabled={busy} onClick={() => acceptLink(l)} aria-label={`Accept link for ${name}`}>Accept link</button>
                      </li>
                    );
                  })}
                </ul>
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
