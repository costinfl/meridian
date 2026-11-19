import React, { useEffect, useMemo, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { getStorageStatus, describeStorage } from "../../storage/persistence.js";
import { createEvidenceLibrary } from "../../evidence/index.js";
import { dryRunLegacyConversion, formatDryRun, convertLegacyFacts, confirmLegacyVerified, countLegacyVerifiedPending, LEGACY_METHOD } from "../../conclusions/legacyFacts.js";
import { currentLinks, decideLink } from "../../conclusions/personaLinks.js";
import { displayName } from "../../models/project.js";
import DocumentsSection from "./DocumentsSection.jsx";
import AiSettings from "./AiSettings.jsx";
import DateConverter from "./DateConverter.jsx";
import SearchSection from "./SearchSection.jsx";
import PeopleSection from "./PeopleSection.jsx";
import MatchesSection from "./MatchesSection.jsx";
import { waitingMatches, openGroups } from "../../conclusions/matching.js";

// The Evidence page (its own page beside the timeline; loaded lazily from App.jsx; on unless the project turns it off).
// Sections: Search, Documents (with the page workspace and the review queue), People (FAN and kinship, Phase 8), Matches (Phase 9), Settings & tools (AI, dates), Legacy facts (Phase 4).
export default function EvidencePage({ onClose, storage, project, onProjectChange, initialSection = "search" }) {
  const [section, setSection] = useState(initialSection);
  const [openAt, setOpenAt] = useState(null);   // a search hit to open in the page workspace
  // a hit with records opens the Records tab (on its box); a text-only hit opens the page's text
  const openHit = (h) => {
    const records = h.regionKind !== "page" || h.hasProposed || h.hasConfirmed || h.shownNames?.length;
    setOpenAt({ copyId: h.copyId, pageId: h.pageId, regionId: h.regionKind === "page" ? null : h.regionId, tab: records ? "records" : "reading", nonce: Date.now() });
    setSection("documents");
  };
  const openRecord = (r) => { setOpenAt({ copyId: r.copyId, pageId: r.pageId, regionId: r.regionId, tab: "records", nonce: Date.now() }); setSection("documents"); };
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

  const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
  const navItem = (id, label, extra = null) => (
    <button key={id} onClick={() => setSection(id)} aria-current={section === id ? "page" : undefined}
      style={{ ...btnStyle(section === id), display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", marginBottom: 6 }}>
      <span>{label}</span>{extra}
    </button>
  );

  return (
    <div data-testid="evidence-page" role="main" aria-label="Evidence" style={{ flex: 1, minHeight: 0, display: "flex", background: C.paperHi }}>
      <nav aria-label="Evidence sections" style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${C.rule}`, padding: 14, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink, marginBottom: 4 }}>Evidence</div>
        <div style={{ ...small, marginBottom: 12 }}>Documents, their text, and the records and facts read from them. Your timeline changes only when you attach evidence to a fact.</div>
        {navItem("search", "Search")}
        {navItem("documents", "Documents")}
        {project?.people?.length > 0 && navItem("people", "People")}
        {project?.people?.length > 0 && navItem("matches", "Matches", waitingMatches(currentLinks(project)).length + openGroups(project).length > 0 ? <span aria-label="matches waiting">•</span> : null)}
        {navItem("ai", "Settings & tools")}
        {report && navItem("legacy", "Legacy facts", pending > 0 || candidates.length > 0 ? <span aria-label="needs attention">•</span> : null)}
        <span style={{ flex: 1 }} />
        <div data-testid="storage-status" style={{ marginTop: 14, font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft, lineHeight: 1.5 }}>{line}</div>
        {onClose && <button onClick={onClose} style={{ ...btnStyle(false), marginTop: 10 }}>← Timeline</button>}
      </nav>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 18px" }}>
        {section === "search" && library && <SearchSection library={library} project={project} onOpen={openHit} />}
        {section === "matches" && library && <MatchesSection library={library} project={project} onProjectChange={onProjectChange} onOpen={openRecord} />}
        {section === "people" && library && <PeopleSection library={library} project={project} onOpen={openRecord} />}
        {section === "documents" && library && <DocumentsSection storage={storage} library={library} inlineWorkspace openAt={openAt} />}
        {section === "ai" && library && storage?.getSetting && <><AiSettings storage={storage} /><DateConverter /></>}
        {section === "legacy" && (
          <>
        {report && (
          <div data-testid="legacy-section">
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

          </>
        )}
      </div>
    </div>
  );
}
