import React, { useMemo, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { RECORD_KINDS, ROLES } from "../../evidence/repositories/recordStore.js";
import { suggestRelations, saveManualRecord } from "../../evidence/index.js";

// Manual record entry (P6.T2): what the researcher reads in the selected region, typed as written.
// Saving confirms every claim (the researcher states it); the record cites the region.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const primary = { ...btnStyle(true), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 5px", minWidth: 0, boxSizing: "border-box" };
const RELATION_LABEL = { childOf: "child of", parentOf: "parent of", spouseOf: "spouse of", godparentOf: "godparent of", witnessFor: "witness for", informantFor: "informant for" };

let nextKey = 1;
const newPerson = (role = "other") => ({ key: `p${nextKey++}`, nameAsWritten: "", role, sex: "", ageAsWritten: "", ageValue: "", occupation: "", residence: "", religion: "" });
const FIRST_ROLES = { baptism: ["child", "father", "mother", "godparent"], birth: ["child", "father", "mother"], marriage: ["groom", "bride", "witness"], death: ["deceased", "informant"], burial: ["deceased", "priest"] };
const relKey = (r) => `${r.subject}|${r.property}|${r.object}`;

/** @param {{ library, regionId: string, regionLabel: string, onSaved: (result) => void, onCancel: () => void }} props */
export default function ManualRecordForm({ library, regionId, regionLabel, onSaved, onCancel }) {
  const [kind, setKind] = useState("death");
  const [date, setDate] = useState({ asWritten: "", year: "", month: "", day: "", calendar: "" });
  const [place, setPlace] = useState("");
  const [people, setPeople] = useState(() => FIRST_ROLES.death.map((r) => newPerson(r)));
  const [ticked, setTicked] = useState({});   // relKey -> { on, asWritten }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(() => suggestRelations(people.filter((p) => p.nameAsWritten.trim())), [people]);
  const nameOf = (key) => people.find((p) => p.key === key)?.nameAsWritten || key;
  const setPerson = (key, patch) => setPeople((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const changeKind = (k) => {
    setKind(k);
    if (people.every((p) => !p.nameAsWritten.trim())) setPeople((FIRST_ROLES[k] ?? ["subject"]).map((r) => newPerson(r)));
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const relations = suggestions.filter((r) => ticked[relKey(r)]?.on).map((r) => ({ ...r, asWritten: ticked[relKey(r)]?.asWritten ?? "" }));
      const result = await saveManualRecord({ library, regionId, form: { kind, eventDate: date, eventPlace: place, personas: people, relations } });
      onSaved(result);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="manual-record-form" style={{ border: `1px solid ${C.rule}`, borderRadius: 3, background: C.paper, padding: 8, display: "grid", gap: 6 }}>
      <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink }}>New record on {regionLabel}</div>
      <div style={small}>Type what is written, as written. Saving records every value as your confirmed reading of this region.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <label style={small}>Kind <select aria-label="Record kind" value={kind} onChange={(e) => changeKind(e.target.value)} style={input}>{RECORD_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label style={{ ...small, flex: "1 1 180px" }}>Place as written <input aria-label="Event place" value={place} onChange={(e) => setPlace(e.target.value)} style={{ ...input, width: "100%" }} /></label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ ...small, flex: "1 1 200px" }}>Date as written <input aria-label="Date as written" value={date.asWritten} onChange={(e) => setDate({ ...date, asWritten: e.target.value })} style={{ ...input, width: "100%" }} /></label>
        <input aria-label="Day" placeholder="day" value={date.day} onChange={(e) => setDate({ ...date, day: e.target.value })} style={{ ...input, width: 44 }} />
        <input aria-label="Month" placeholder="month" value={date.month} onChange={(e) => setDate({ ...date, month: e.target.value })} style={{ ...input, width: 52 }} />
        <input aria-label="Year" placeholder="year" value={date.year} onChange={(e) => setDate({ ...date, year: e.target.value })} style={{ ...input, width: 56 }} />
        <select aria-label="Calendar" value={date.calendar} onChange={(e) => setDate({ ...date, calendar: e.target.value })} style={input} title="Before 1919 Romanian records use the Julian calendar">
          <option value="">calendar: automatic</option><option value="julian">Julian</option><option value="gregorian">Gregorian</option>
        </select>
      </div>

      <div style={{ font: "600 11.5px Archivo, sans-serif", color: C.ink, marginTop: 4 }}>People</div>
      {people.map((p, i) => (
        <div key={p.key} data-testid="person-row" style={{ display: "grid", gridTemplateColumns: "minmax(120px,2fr) minmax(80px,1fr) 70px minmax(70px,1fr) 46px minmax(80px,1fr) minmax(80px,1fr) auto", gap: 4, alignItems: "center" }}>
          <input aria-label={`Name as written ${i + 1}`} placeholder="name as written" value={p.nameAsWritten} onChange={(e) => setPerson(p.key, { nameAsWritten: e.target.value })} style={input} />
          <select aria-label={`Role ${i + 1}`} value={p.role} onChange={(e) => setPerson(p.key, { role: e.target.value })} style={input}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <select aria-label={`Sex ${i + 1}`} value={p.sex} onChange={(e) => setPerson(p.key, { sex: e.target.value })} style={input}><option value="">sex?</option><option value="female">female</option><option value="male">male</option></select>
          <input aria-label={`Age as written ${i + 1}`} placeholder="age as written" value={p.ageAsWritten} onChange={(e) => setPerson(p.key, { ageAsWritten: e.target.value })} style={input} />
          <input aria-label={`Age ${i + 1}`} placeholder="age" value={p.ageValue} onChange={(e) => setPerson(p.key, { ageValue: e.target.value })} style={input} />
          <input aria-label={`Occupation ${i + 1}`} placeholder="occupation" value={p.occupation} onChange={(e) => setPerson(p.key, { occupation: e.target.value })} style={input} />
          <input aria-label={`Residence ${i + 1}`} placeholder="residence" value={p.residence} onChange={(e) => setPerson(p.key, { residence: e.target.value })} style={input} />
          <button style={mini} aria-label={`Remove person ${i + 1}`} onClick={() => setPeople((ps) => ps.filter((x) => x.key !== p.key))}>×</button>
        </div>
      ))}
      <div><button style={mini} onClick={() => setPeople((ps) => [...ps, newPerson()])}>+ person</button></div>

      {suggestions.length > 0 && (
        <div data-testid="relations">
          <div style={{ font: "600 11.5px Archivo, sans-serif", color: C.ink }}>Relations stated in the record (tick the ones it says)</div>
          {suggestions.map((r) => {
            const k = relKey(r), t = ticked[k] ?? { on: false, asWritten: "" };
            return (
              <div key={k} style={{ ...small, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <label><input type="checkbox" checked={t.on} onChange={(e) => setTicked({ ...ticked, [k]: { ...t, on: e.target.checked } })} /> {nameOf(r.subject)} — {RELATION_LABEL[r.property]} — {nameOf(r.object)}</label>
                {t.on && <input aria-label={`Words for ${nameOf(r.subject)} ${RELATION_LABEL[r.property]} ${nameOf(r.object)}`} placeholder="as written (optional)" value={t.asWritten} onChange={(e) => setTicked({ ...ticked, [k]: { ...t, asWritten: e.target.value } })} style={{ ...input, width: 160 }} />}
              </div>
            );
          })}
        </div>
      )}

      {error && <div role="alert" style={{ ...small, color: C.focus }}>Not saved: {error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={primary} disabled={busy} onClick={save}>Save record</button>
        <button style={mini} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
