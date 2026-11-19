import React, { useMemo, useState } from "react";
import { C, btnStyle } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { displayName } from "../models/project.js";
import { createPerson, updatePersonBasics, setParent, addSpouse, removeSpouse, addChild, familyOf } from "../models/personEdit.js";

// Person panel (Phase 9 review, d): name, sex, father, mother, spouses and children, edited in the app. Families stay
// the source of truth; the timeline's kinship labels and Matches follow at once.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "3px 6px" };
const row = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 };
const head = { font: "700 11px Archivo, sans-serif", letterSpacing: ".06em", textTransform: "uppercase", color: C.inkSoft, width: 70 };
const years = (p) => (p ? `${p.birth?.year ?? "?"}–${p.death?.year ?? "…"}` : "");
const NEW = "__new__";

/** A picker of people, with "+ new person…" (asks for a name). */
function PickPerson({ label, people, exclude = [], onPick, sex }) {
  const [v, setV] = useState("");
  const [name, setName] = useState("");
  const options = people.filter((p) => !exclude.includes(p.id) && (!sex || !p.sex || p.sex === "U" || p.sex === sex));
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <select aria-label={label} value={v} onChange={(e) => setV(e.target.value)} style={input}>
        <option value="">{label}…</option>
        <option value={NEW}>+ new person…</option>
        {options.map((p) => <option key={p.id} value={p.id}>{displayName(p)} ({years(p)})</option>)}
      </select>
      {v === NEW && <input aria-label={`${label}: new person's name`} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, width: 160 }} />}
      <button style={mini} disabled={!v || (v === NEW && !name.trim())} onClick={() => { onPick(v === NEW ? { newName: name.trim() } : { id: v }); setV(""); setName(""); }}>Set</button>
    </span>
  );
}

/**
 * @param {{ project, personId, onChange: (updater) => void, onOpenPerson: (id) => void, onClose }} props
 * onChange receives a function (project) => project, applied to the latest project.
 */
export default function PersonPanel({ project, personId, onChange, onOpenPerson, onClose }) {
  const fam = useMemo(() => familyOf(project, personId), [project, personId]);
  const [error, setError] = useState("");
  const [basics, setBasics] = useState(() => ({ name: fam?.person.name ?? "", sex: fam?.person.sex ?? "U" }));
  if (!fam) return null;
  const people = [...(project.people ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const apply = (fn) => {
    setError("");
    try { const next = fn(project); onChange(() => next); } catch (e) { setError(e.message); }
  };
  // resolve a pick: an existing id, or a new person created first
  const withPick = (pick, sex, fn) => apply((p) => {
    if (pick.id) return fn(p, pick.id);
    const r = createPerson(p, { name: pick.newName, sex });
    return fn(r.project, r.person.id);
  });
  const confirmReplace = (current, role) => !current || window.confirm(`Replace ${displayName(current)} as ${role}?`);
  const link = (p) => <button style={{ ...mini, border: "none", textDecoration: "underline", padding: 0 }} onClick={() => onOpenPerson(p.id)}>{displayName(p)}</button>;

  return (
    <Modal title={`Family of ${displayName(fam.person)}`} onClose={onClose} width={560}>
      <div data-testid="person-panel">
        <div style={row}>
          <span style={head}>Name</span>
          <input aria-label="Name" value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} style={{ ...input, flex: "1 1 200px" }} />
          <select aria-label="Sex" value={basics.sex} onChange={(e) => setBasics({ ...basics, sex: e.target.value })} style={input}>
            <option value="M">man</option><option value="F">woman</option><option value="U">unknown</option>
          </select>
          <button style={mini} disabled={basics.name.trim() === fam.person.name && basics.sex === fam.person.sex} onClick={() => apply((p) => updatePersonBasics(p, personId, basics))}>Save</button>
        </div>

        {[["father", "Father", fam.father, "M"], ["mother", "Mother", fam.mother, "F"]].map(([role, title, current, sex]) => (
          <div key={role} style={row} data-testid={`panel-${role}`}>
            <span style={head}>{title}</span>
            {current ? <span>{link(current)} <span style={small}>{years(current)}</span></span> : <span style={small}>not known</span>}
            <PickPerson label={current ? `Change ${role}` : `Set ${role}`} people={people} exclude={[personId]} sex={sex}
              onPick={(pick) => confirmReplace(current, role) && withPick(pick, sex, (p, id) => setParent(p, personId, role, id))} />
            {current && <button style={mini} onClick={() => apply((p) => setParent(p, personId, role, null))}>Remove</button>}
          </div>
        ))}

        <div style={row} data-testid="panel-spouses">
          <span style={head}>Spouses</span>
          {fam.spouses.length ? fam.spouses.map((s) => (
            <span key={s.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>{link(s)}
              <button style={mini} aria-label={`Remove spouse ${displayName(s)}`} onClick={() => apply((p) => removeSpouse(p, personId, s.id))}>×</button></span>
          )) : <span style={small}>none</span>}
          <PickPerson label="Add spouse" people={people} exclude={[personId, ...fam.spouses.map((s) => s.id)]}
            sex={fam.person.sex === "M" ? "F" : fam.person.sex === "F" ? "M" : null}
            onPick={(pick) => withPick(pick, fam.person.sex === "M" ? "F" : fam.person.sex === "F" ? "M" : "U", (p, id) => addSpouse(p, personId, id))} />
        </div>

        <div style={row} data-testid="panel-children">
          <span style={head}>Children</span>
          {fam.children.length ? fam.children.map((c) => <span key={c.id}>{link(c)} <span style={small}>{years(c)}</span></span>) : <span style={small}>none</span>}
          <PickPerson label="Add child" people={people} exclude={[personId, ...fam.children.map((c) => c.id)]}
            onPick={(pick) => withPick(pick, "U", (p, id) => addChild(p, personId, id))} />
        </div>

        {error && <div role="alert" style={{ ...small, color: C.focus }}>{error}</div>}
        <div style={{ ...small, marginTop: 8 }}>
          A child added here keeps their other parent. Changes are saved with the project; the kinship labels follow at once.
        </div>
      </div>
    </Modal>
  );
}
