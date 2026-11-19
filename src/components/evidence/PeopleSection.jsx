import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { buildTrackedGraph, updateGraph, fanOf, kinshipLabel, commonAncestors } from "../../graph/index.js";
import { currentLinks } from "../../conclusions/personaLinks.js";
import { displayName } from "../../models/project.js";
import { ROLES } from "../../evidence/repositories/recordStore.js";
import { propertyLabel } from "./RecordsTab.jsx";

// People (P8.T5): a person's FAN (family, associates, neighbours) as a list by record: for every record the person
// appears in, the date, place and source, their role, and the other people in it with their roles, the relations
// the record states and who they are. Accepted links are followed; candidate links are shown as "possible".

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px" };
const linkBtn = { background: "none", border: "none", padding: 0, font: "600 12px Archivo, sans-serif", color: C.rel[2], textDecoration: "underline", cursor: "pointer" };
const int = (v) => (String(v).trim() === "" ? undefined : Number.isInteger(Number(v)) ? Number(v) : undefined);

function RecordCard({ entry, onPerson, onOpen }) {
  const r = entry.record;
  return (
    <li data-testid="fan-record" style={{ border: `1px solid ${C.rule}`, borderRadius: 3, background: "#fff", padding: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink }}>
          {r.kind}{r.dateLabel ? ` · ${r.dateLabel}` : ""}{r.placeText ? ` · ${r.placeText}` : ""}
        </span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={mono}>{r.sourceTitle || r.fileName}{r.pageIndex != null ? ` · page ${r.pageIndex + 1}${r.pageLabel ? ` (${r.pageLabel})` : ""}` : ""}</span>
          {onOpen && r.pageId && <button style={mini} onClick={() => onOpen(r)}>Open page</button>}
        </span>
      </div>
      <div style={small}>
        As <strong style={{ color: C.ink }}>{entry.self.role}</strong> (“{entry.self.nameAsWritten}”){entry.link?.status === "candidate" ? <span style={{ color: C.rel[1] }}> — possible: this link is not accepted yet</span> : null}
      </div>
      <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
        {entry.others.map((o) => (
          <li key={o.persona.id} data-testid="fan-other" style={{ ...small, color: C.ink, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ color: C.inkSoft, minWidth: 74 }}>{o.persona.role}</span>
            <span style={{ fontWeight: 600 }}>{o.persona.nameAsWritten}</span>
            {o.relations.map((rel, i) => (
              <span key={i} style={mono}>{rel.direction === "theirs" ? propertyLabel(rel.property) : `${entry.self.nameAsWritten.split(" ")[0]} is ${propertyLabel(rel.property)} them`}{rel.originalValue ? ` (“${rel.originalValue}”)` : ""}{rel.status === "proposed" ? " · proposed" : ""}</span>
            ))}
            {o.sameHouse && <span style={mono}>same house</span>}
            {o.persons.map((p) => (
              <span key={p.personId}>
                {p.status === "accepted" ? "→ " : <span style={{ color: C.rel[1] }}>→ possible: </span>}
                <button style={linkBtn} onClick={() => onPerson(p.personId)}>{p.name || p.personId}</button>
              </span>
            ))}
          </li>
        ))}
        {!entry.others.length && <li style={small}>Nobody else is recorded in this entry.</li>}
      </ul>
    </li>
  );
}

/** @param {{ library, project, onOpen?: (record) => void }} props */
export default function PeopleSection({ library, project, onOpen }) {
  const people = useMemo(() => [...(project?.people ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b))), [project]);
  const byId = useMemo(() => Object.fromEntries((project?.people ?? []).map((p) => [p.id, p])), [project]);
  const focusId = project?.settings?.focusPersonId ?? people[0]?.id ?? "";
  const [personId, setPersonId] = useState(focusId);
  const [f, setF] = useState({ role: "", fromYear: "", toYear: "", hops: 1 });
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState("");
  const graphRef = useRef(null);
  const [sources, setSources] = useState({});

  useEffect(() => {
    let live = true;
    (async () => {
      const inputs = {
        snapshot: await library.searchIndex.snapshot(),
        people: project?.people ?? [], families: project?.families ?? [], links: project ? currentLinks(project) : [], relationships: project?.relationships ?? [],
      };
      const g = graphRef.current ? updateGraph(graphRef.current, inputs).graph : buildTrackedGraph(inputs);
      graphRef.current = g;
      setSources(Object.fromEntries(inputs.snapshot.sources.map((s) => [s.id, s.title])));
      if (live) setGraph({ g, at: Date.now() });
    })().catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [library, project]);

  const fan = useMemo(() => {
    if (!graph || !personId) return null;
    const res = fanOf(graph.g, { personId, hops: f.hops, roles: f.role ? [f.role] : null, fromYear: int(f.fromYear), toYear: int(f.toYear) });
    const named = (e) => ({ ...e, record: { ...e.record, sourceTitle: sources[e.record.sourceId] ?? "" } });
    return { ...res, entries: res.entries.map(named), second: res.second.map((s) => ({ ...s, entries: s.entries.map(named) })) };
  }, [graph, personId, f, sources]);

  const person = byId[personId];
  const focus = byId[focusId];
  const kin = person && focus && person.id !== focus.id ? kinshipLabel(byId, focus, person) : "";
  const shared = person && focus && person.id !== focus.id ? commonAncestors(byId, focus.id, person.id).slice(0, 4) : [];
  const set = (k) => (e) => setF({ ...f, [k]: k === "hops" ? Number(e.target.value) : e.target.value });

  if (!project?.people?.length) return <div data-testid="people-section" style={small}>This project has no people yet.</div>;
  return (
    <div data-testid="people-section">
      <div style={{ font: "700 13px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>People: family, associates, neighbours</div>
      <div style={small}>
        Everyone a person stood beside in the records: godparents, witnesses, informants, neighbours. Records come from the
        people's links (accepted; <span style={{ color: C.rel[1] }}>possible</span> = a link not accepted yet).
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0", ...small }}>
        <label>Person <select aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)} style={input}>
          {people.map((p) => <option key={p.id} value={p.id}>{displayName(p) || p.id}</option>)}
        </select></label>
        <label>Records with a <select aria-label="Role" value={f.role} onChange={set("role")} style={input}><option value="">any</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label>Years <input aria-label="From year" placeholder="from" value={f.fromYear} onChange={set("fromYear")} style={{ ...input, width: 54 }} /> – <input aria-label="To year" placeholder="to" value={f.toYear} onChange={set("toYear")} style={{ ...input, width: 54 }} /></label>
        <label>Steps <select aria-label="Steps" value={f.hops} onChange={set("hops")} style={input}><option value={1}>1</option><option value={2}>2</option></select></label>
      </div>

      {focus && person && person.id !== focus.id && (
        <div data-testid="kinship" style={{ ...small, marginBottom: 8 }}>
          Kinship: <strong style={{ color: C.ink }}>{displayName(person)}</strong> is the <strong style={{ color: C.ink }}>{kin || "—"}</strong> of {displayName(focus)} (the timeline's focus).
          {shared.length > 0 && <> Nearest common ancestors: {shared.map((c) => `${displayName(byId[c.id])} (${c.a} and ${c.b} generations up)`).join("; ")}.</>}
        </div>
      )}

      {error && <div role="alert" style={{ ...small, color: C.focus }}>Could not build the graph: {error}</div>}
      {!fan ? <div style={small}>Building…</div> : (
        <>
          <div role="status" style={{ ...small, marginBottom: 6 }}>
            {fan.entries.length ? `${fan.entries.length} record${fan.entries.length === 1 ? "" : "s"}${fan.possible ? ` (${fan.possible} through possible links)` : ""}` : "No records linked to this person yet (link a record's person to them in Records or Legacy facts)."}
          </div>
          <ul data-testid="fan-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {fan.entries.map((e) => <RecordCard key={e.record.id + e.self.id} entry={e} onPerson={setPersonId} onOpen={onOpen} />)}
          </ul>
          {fan.second.length > 0 && (
            <div data-testid="fan-second" style={{ marginTop: 8 }}>
              <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>One step further</div>
              {fan.second.map((s) => (
                <div key={s.person.id} style={{ marginBottom: 6 }}>
                  <div style={small}>Records of {s.status === "candidate" && <span style={{ color: C.rel[1] }}>possible: </span>}<button style={linkBtn} onClick={() => setPersonId(s.person.id)}>{s.person.name}</button> (“{s.via.nameAsWritten}”, {s.via.role})</div>
                  <ul style={{ listStyle: "none", margin: "4px 0 0 12px", padding: 0 }}>
                    {s.entries.map((e) => <RecordCard key={e.record.id + e.self.id} entry={e} onPerson={setPersonId} onOpen={onOpen} />)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
