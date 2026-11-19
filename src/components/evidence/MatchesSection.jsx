import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { prepareRecords, recordPart } from "../../graph/projection.js";
import { personaProfiles, personDraft, YEAR_DAYS } from "../../resolve/profiles.js";
import { createResolveClient, runMatching } from "../../workers/resolveClient.js";
import { currentLinks } from "../../conclusions/personaLinks.js";
import {
  waitingMatches, openGroups, matchingState, acceptMatch, rejectMatch, linkMatchTo, createPersonFromPersonas,
  linkGroupTo, dismissGroup, removeFromGroup, variantSuggestions, setMatchingWeights, unlinkMatch, acceptedLinks,
} from "../../conclusions/matching.js";
import { calibrationReport, MIN_DECISIONS } from "../../resolve/calibration.js";
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLD } from "../../resolve/score.js";
import { displayName } from "../../models/project.js";
import { HitCrop } from "./SearchSection.jsx";

// Matches (P9.T4): who in the records is who in the tree. "Find matches" runs locally (no AI, no cost) and proposes
// candidates; nothing is linked until you decide here. Rejected pairs are never proposed again.

const DECIDED_BY = "user";
const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const primary = { ...btnStyle(true), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px" };
const card = { border: `1px solid ${C.rule}`, borderRadius: 3, background: "#fff", padding: 8, marginBottom: 8 };
const SIGNAL_LABELS = { given: "given name", surname: "surname", date: "dates", sex: "sex", place: "place", occupation: "work", relatives: "relatives", fan: "people around" };
const BANDS = [["", "any score"], ["0.9", "0.90 and up"], ["0.8", "0.80–0.90"], ["0.7", "0.70–0.80"]];
const inBand = (s, b) => !b || (b === "0.9" ? s >= 0.9 : b === "0.8" ? s >= 0.8 && s < 0.9 : s < 0.8);
const yearOf = (day) => Math.round(1 + (day - 1721426) / YEAR_DAYS);
const range = (r) => (!r ? "" : yearOf(r[0]) === yearOf(r[1]) ? String(yearOf(r[0])) : `${yearOf(r[0])}–${yearOf(r[1])}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

function Signals({ signals, detail }) {
  const parts = Object.entries(SIGNAL_LABELS).filter(([k]) => signals?.[k] != null).map(([k, label]) => `${label} ${Number(signals[k]).toFixed(2)}`);
  const rel = (signals?.relativesMatched ?? detail?.relatives ?? []).map((m) => `${m.relation} ${m.a} ↔ ${m.b}`);
  return (
    <div data-testid="match-signals" style={mono}>
      {parts.join(" · ")}{rel.length ? ` · ${rel.join("; ")}` : ""}
      {signals?.usesProposed && <span style={{ color: C.rel[1] }}> · based on proposed values</span>}
    </div>
  );
}

/** How good the proposals were, from your decisions; suggested weights only on request. */
function Calibration({ project, onProjectChange }) {
  const report = useMemo(() => calibrationReport(currentLinks(project), { weights: matchingState(project)?.weights ?? DEFAULT_WEIGHTS }), [project]);
  const custom = matchingState(project)?.weights;
  const th = { textAlign: "left", font: "600 11px Archivo, sans-serif", color: C.inkSoft, padding: "1px 8px 1px 0" };
  const td = { ...mono, padding: "1px 8px 1px 0" };
  return (
    <details data-testid="calibration" style={{ ...small, margin: "6px 0" }}>
      <summary style={{ cursor: "pointer" }}>How good are the proposals? ({report.decisions} decided: {report.accepted} accepted, {report.rejected} rejected)</summary>
      {report.decisions === 0 ? <div>Accept or reject some proposals first.</div> : (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 4 }}>
          <table><thead><tr><th style={th}>Score</th><th style={th}>Decided</th><th style={th}>Accepted</th></tr></thead>
            <tbody>{report.bands.map((b) => <tr key={b.label}><td style={td}>{b.label}</td><td style={td}>{b.n}</td><td style={td}>{b.rate == null ? "—" : `${Math.round(b.rate * 100)}%`}</td></tr>)}</tbody></table>
          <table><thead><tr><th style={th}>Signal</th><th style={th}>Accepted (mean)</th><th style={th}>Rejected (mean)</th></tr></thead>
            <tbody>{report.signals.map((x) => <tr key={x.signal}><td style={td}>{SIGNAL_LABELS[x.signal]}</td><td style={td}>{x.accepted ?? "—"}</td><td style={td}>{x.rejected ?? "—"}</td></tr>)}</tbody></table>
        </div>
      )}
      {report.suggestion ? (
        <div data-testid="calibration-suggestion" style={{ marginTop: 4 }}>
          Suggested from your decisions: {Object.entries(report.suggestion.weights).map(([k, v]) => `${SIGNAL_LABELS[k]} ${v.toFixed(2)}`).join(" · ")}; propose from {report.suggestion.threshold.toFixed(2)}.{" "}
          <button style={mini} onClick={() => onProjectChange((p) => setMatchingWeights(p, report.suggestion))}>Use these weights</button>
        </div>
      ) : report.decisions > 0 && <div style={{ marginTop: 4 }}>Weights can be suggested after {MIN_DECISIONS} decisions with both accepts and rejects.</div>}
      {custom && (
        <div style={{ marginTop: 4 }}>Your weights are in use (propose from {(matchingState(project)?.threshold ?? DEFAULT_THRESHOLD).toFixed(2)}).{" "}
          <button style={mini} onClick={() => onProjectChange((p) => setMatchingWeights(p, null))}>Back to the standard weights</button></div>
      )}
    </details>
  );
}

function PersonaSide({ library, prof, rec, box, onOpen }) {
  if (!prof) return <div style={small}>(this record is no longer in the library)</div>;
  return (
    <div style={{ display: "flex", gap: 8, minWidth: 0, flex: "1 1 280px" }}>
      {rec?.pageId && box && <HitCrop library={library} hit={{ pageId: rec.pageId, box }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink }}>“{prof.nameAsWritten}” <span style={{ ...small, fontWeight: 400 }}>as {prof.role}</span></div>
        <div style={small}>{rec?.kind}{rec?.dateLabel ? ` · ${rec.dateLabel}` : ""}{rec?.placeText ? ` · ${rec.placeText}` : ""}</div>
        <div style={small}>{prof.birth ? `born ${range(prof.birth)}` : ""}{prof.sex ? ` · ${prof.sex === "M" ? "man" : "woman"}` : ""}</div>
        {prof.relatives.length > 0 && <div style={small}>{prof.relatives.map((r) => `${r.relation}: ${r.name}`).join(" · ")}</div>}
        {onOpen && rec?.pageId && <button style={{ ...mini, marginTop: 4 }} onClick={() => onOpen(rec)}>Open page</button>}
      </div>
    </div>
  );
}

function PersonSide({ person, byId }) {
  if (!person) return <div style={small}>(person not in this project)</div>;
  const nameOf = (id) => (byId[id] ? displayName(byId[id]) : "");
  const rels = [person.fatherId && `father: ${nameOf(person.fatherId)}`, person.motherId && `mother: ${nameOf(person.motherId)}`, ...(person.spouseIds ?? []).map((s) => `spouse: ${nameOf(s)}`)].filter(Boolean);
  return (
    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
      <div style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink }}>{displayName(person)}</div>
      <div style={small}>{person.birth?.year ?? "?"}–{person.death?.year ?? "…"}{person.birth?.place ? ` · born ${person.birth.place}` : ""}</div>
      {rels.length > 0 && <div style={small}>{rels.join(" · ")}</div>}
    </div>
  );
}

function PersonPicker({ people, label, onPick, exclude }) {
  const [v, setV] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <select aria-label={label} value={v} onChange={(e) => setV(e.target.value)} style={input}>
        <option value="">{label}…</option>
        {people.filter((p) => p.id !== exclude).map((p) => <option key={p.id} value={p.id}>{displayName(p)}{p.birth?.year ? ` (${p.birth.year})` : ""}</option>)}
      </select>
      <button style={mini} disabled={!v} onClick={() => onPick(v)}>Link</button>
    </span>
  );
}

/** @param {{ library, project, onProjectChange: (updater) => void, onOpen?: (record) => void }} props */
export default function MatchesSection({ library, project, onProjectChange, onOpen }) {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState({ personId: "", band: "" });
  const [suggest, setSuggest] = useState([]);           // name variant suggestions after accepts
  const [linkedFilter, setLinkedFilter] = useState("");
  const [linkedShown, setLinkedShown] = useState(20);
  const clientRef = useRef(null);
  useEffect(() => () => { clientRef.current?.close(); clientRef.current = null; }, []);

  const reload = async () => setSnapshot(await library.searchIndex.snapshot());
  useEffect(() => { reload().catch((e) => setError(e.message)); }, [library]); // eslint-disable-line react-hooks/exhaustive-deps

  const profiles = useMemo(() => (snapshot ? personaProfiles(snapshot) : new Map()), [snapshot]);
  const records = useMemo(() => {
    if (!snapshot) return { byId: new Map(), boxOf: () => null };
    const ctx = prepareRecords(snapshot);
    const byId = new Map();
    for (const id of ctx.records.keys()) { const part = recordPart(ctx, id); if (part) byId.set(id, part.record); }
    const regions = new Map(snapshot.regions.map((r) => [r.id, r]));
    const personaRegion = new Map(snapshot.personas.map((p) => [p.id, p.regionId]));
    return { byId, boxOf: (personaId, rec) => regions.get(personaRegion.get(personaId) ?? rec?.regionId)?.box ?? null };
  }, [snapshot]);
  const people = useMemo(() => [...(project?.people ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b))), [project]);
  const byId = useMemo(() => Object.fromEntries((project?.people ?? []).map((p) => [p.id, p])), [project]);
  const waiting = useMemo(() => (project ? waitingMatches(currentLinks(project)) : []).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), [project]);
  const shown = waiting.filter((l) => (!filter.personId || l.personId === filter.personId) && inBand(l.score ?? 0, filter.band));
  const groups = openGroups(project);
  const linked = useMemo(() => (project ? acceptedLinks(project) : []), [project]);
  const linkedList = linked.filter((l) => !linkedFilter || l.personId === linkedFilter);
  const METHOD = { "entity-resolution": "from Matches", manual: "by hand", "legacy-import": "from a legacy fact" };
  const last = matchingState(project)?.lastRun;

  const find = async (full) => {
    setBusy(full ? "Rechecking everything…" : "Finding matches…"); setError(""); setMessage("");
    try {
      clientRef.current ??= createResolveClient({ library });
      const { result, apply } = await runMatching({ library, project, client: clientRef.current, full });
      let summary = null;
      onProjectChange((latest) => { const r = apply(latest); summary = r; return r.project; });
      const c = result.counts;
      setMessage(`Compared ${c.rawPairs.toLocaleString()} pairs · ${summary?.added ?? c.proposed} proposed · ${c.groups} group${c.groups === 1 ? "" : "s"}${c.skippedRejected ? ` · ${c.skippedRejected} skipped (rejected before)` : ""} · ${c.ms} ms`);
      await reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };
  const decide = (fn, note) => { try { onProjectChange((p) => fn(p).project); if (note) setMessage(note); } catch (e) { setError(e.message); } };
  const accept = (l) => {
    const prof = profiles.get(l.personaId), person = byId[l.personId];
    decide((p) => acceptMatch(p, l.id, { decidedBy: DECIDED_BY }), `Accepted: “${prof?.nameAsWritten}” is ${displayName(person)}.`);
    const s = variantSuggestions(prof?.name, displayName(person), snapshot?.nameVariants ?? []);
    if (s.length) setSuggest((x) => [...x, ...s.filter((n) => !x.some((y) => y.canonical === n.canonical && y.variant === n.variant))]);
  };
  const addVariant = async (v) => {
    try { await library.nameVariants.add({ canonical: v.canonical, variant: v.variant, origin: "learned" }); setMessage(`Name variant added: ${v.canonical} – ${v.variant}.`); }
    catch (e) { setError(e.message); }
    setSuggest((x) => x.filter((y) => y !== v));
    reload();
  };
  const create = (personaIds, groupId = null) => {
    const draft = personDraft(personaIds.map((id) => profiles.get(id)));
    decide((p) => createPersonFromPersonas(p, personaIds, draft, { decidedBy: DECIDED_BY, groupId }), `New person created: ${draft.name}. Add them to the timeline with + relative.`);
  };

  if (!project) return null;
  return (
    <div data-testid="matches-section">
      <div style={{ font: "700 13px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Matches: who in the records is who in your tree</div>
      <div style={small}>
        Find matches compares the people named in records with the people of your tree, and with each other, on this
        device (no AI, no cost). Nothing is linked until you accept it; a rejected match is never proposed again.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <button style={primary} disabled={!!busy || !snapshot} onClick={() => find(false)}>Find matches</button>
        <button style={mini} disabled={!!busy || !snapshot} onClick={() => find(true)} title="Compare everything again, not only what changed since the last run">Recheck everything</button>
        <span role="status" data-testid="matches-status" style={small}>{busy || message || (last ? `Last run ${when(last.at)}: ${last.counts.proposed} proposed, ${last.counts.groups} groups (${last.scope === "all" ? "everything" : "changes only"}).` : "Not run yet.")}</span>
      </div>
      {error && <div role="alert" style={{ ...small, color: C.focus }}>{error}</div>}
      <Calibration project={project} onProjectChange={onProjectChange} />

      {suggest.length > 0 && (
        <div data-testid="variant-suggestions" style={{ ...card, background: C.paperHi }}>
          <div style={small}>The record spells a name differently from your tree. Pair the spellings so search and matching treat them as one name?</div>
          {suggest.map((v) => (
            <span key={`${v.canonical}|${v.variant}`} style={{ display: "inline-flex", gap: 4, marginRight: 10 }}>
              <button style={mini} onClick={() => addVariant(v)}>Add name variant {v.canonical} – {v.variant}</button>
              <button style={{ ...mini, border: "none" }} aria-label={`Ignore ${v.canonical} – ${v.variant}`} onClick={() => setSuggest((x) => x.filter((y) => y !== v))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink, margin: "10px 0 4px" }}>Proposed for people of your tree ({waiting.length})</div>
      {waiting.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6, ...small }}>
          <label>Person <select aria-label="Filter by person" value={filter.personId} onChange={(e) => setFilter({ ...filter, personId: e.target.value })} style={input}>
            <option value="">anyone</option>{people.filter((p) => waiting.some((l) => l.personId === p.id)).map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select></label>
          <label>Score <select aria-label="Filter by score" value={filter.band} onChange={(e) => setFilter({ ...filter, band: e.target.value })} style={input}>
            {BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        </div>
      )}
      {!waiting.length && <div style={small}>Nothing waiting. {last ? "" : "Press Find matches."}</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((l) => {
          const prof = profiles.get(l.personaId), rec = prof ? records.byId.get(prof.recordId) : null;
          return (
            <li key={l.id} data-testid="match-candidate" style={card}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                <PersonaSide library={library} prof={prof} rec={rec} box={prof ? records.boxOf(l.personaId, rec) : null} onOpen={onOpen} />
                <div style={{ font: "700 13px Archivo, sans-serif", color: C.slate, alignSelf: "center" }} aria-label={`score ${l.score}`}>{(l.score ?? 0).toFixed(2)} →</div>
                <PersonSide person={byId[l.personId]} byId={byId} />
              </div>
              <Signals signals={l.signals} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <button style={primary} onClick={() => accept(l)}>Accept</button>
                <button style={mini} onClick={() => decide((p) => rejectMatch(p, l.id, { decidedBy: DECIDED_BY }), "Rejected; it will not be proposed again.")}>Reject</button>
                <PersonPicker people={people} label="Someone else" exclude={l.personId} onPick={(pid) => decide((p) => linkMatchTo(p, l.id, pid, { decidedBy: DECIDED_BY }), `Linked to ${displayName(byId[pid])}.`)} />
                <button style={mini} title="Not anyone in the tree yet: create a person from this record (this proposal is then rejected)" onClick={() => create([l.personaId])}>Create new person</button>
              </div>
            </li>
          );
        })}
      </ul>

      <details data-testid="linked-list" style={{ margin: "10px 0 4px" }}>
        <summary style={{ font: "700 12px Archivo, sans-serif", color: C.ink, cursor: "pointer" }}>Linked to people of your tree ({linked.length})</summary>
        <div style={{ ...small, margin: "4px 0" }}>
          Every record person you linked, newest first. <strong>Unlink</strong> if a link was wrong (it will not be proposed again);
          <strong> Back to waiting</strong> if you are no longer sure. Proposals rejected only because of that link come back.
        </div>
        {linked.length > 0 && (
          <label style={{ ...small, display: "block", marginBottom: 6 }}>Person <select aria-label="Linked person" value={linkedFilter} onChange={(e) => { setLinkedFilter(e.target.value); setLinkedShown(20); }} style={input}>
            <option value="">anyone</option>{people.filter((p) => linked.some((l) => l.personId === p.id)).map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select></label>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {linkedList.slice(0, linkedShown).map((l) => {
            const prof = profiles.get(l.personaId), rec = prof ? records.byId.get(prof.recordId) : null;
            return (
              <li key={l.id} data-testid="linked-item" style={card}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <PersonaSide library={library} prof={prof} rec={rec} box={prof ? records.boxOf(l.personaId, rec) : null} onOpen={onOpen} />
                  <div style={{ ...small, alignSelf: "center" }}>linked {METHOD[l.method] ?? l.method}{l.decidedAt ? ` · ${new Date(l.decidedAt).toLocaleDateString()}` : ""} →</div>
                  <PersonSide person={byId[l.personId]} byId={byId} />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button style={mini} onClick={() => decide((p) => unlinkMatch(p, l.id, { decidedBy: DECIDED_BY }), "Unlinked; this pair will not be proposed again.")}>Unlink (wrong)</button>
                  <button style={mini} onClick={() => decide((p) => unlinkMatch(p, l.id, { decidedBy: DECIDED_BY, wrong: false }), "Back to waiting.")}>Back to waiting</button>
                </div>
              </li>
            );
          })}
        </ul>
        {linkedList.length > linkedShown && <button style={mini} onClick={() => setLinkedShown((n) => n + 50)}>Show more ({linkedList.length - linkedShown})</button>}
      </details>

      <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink, margin: "10px 0 4px" }}>Same person in several records, not in your tree ({groups.length})</div>
      {!groups.length && <div style={small}>No groups.</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {groups.map((g) => (
          <li key={g.id} data-testid="match-group" style={card}>
            <div style={{ ...small, marginBottom: 4 }}>
              {g.personaIds.length} records · score {g.score.toFixed(2)}{g.usesProposed && <span style={{ color: C.rel[1] }}> · based on proposed values</span>}
            </div>
            {g.personaIds.map((id) => {
              const prof = profiles.get(id), rec = prof ? records.byId.get(prof.recordId) : null;
              return (
                <div key={id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                  <PersonaSide library={library} prof={prof} rec={rec} box={prof ? records.boxOf(id, rec) : null} onOpen={onOpen} />
                  <button style={mini} onClick={() => decide((p) => removeFromGroup(p, g.id, id, { decidedBy: DECIDED_BY }), "Removed from the group.")}>Not this one</button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={primary} onClick={() => create(g.personaIds, g.id)}>Create new person from these</button>
              <PersonPicker people={people} label="Link all to" onPick={(pid) => decide((p) => linkGroupTo(p, g.id, pid, { decidedBy: DECIDED_BY }), `Linked to ${displayName(byId[pid])}.`)} />
              <button style={mini} onClick={() => decide((p) => dismissGroup(p, g.id, { decidedBy: DECIDED_BY }), "Not the same; this group will not be proposed again.")}>Not the same</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
