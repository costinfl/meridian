import React, { useEffect, useState } from "react";
import { C, btnStyle } from "../../theme.js";

// Name variants (Phase 7 review, c): the spellings and language forms you paired (Ioan – Iohannes, Hariton –
// Haritonu), yours or learned from Matches. Search and matching use a pair one step only and never chain pairs; a
// pair says two spellings are one name, never that two people are the same.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "3px 6px" };
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

export default function NameVariants({ library }) {
  const [pairs, setPairs] = useState(null);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({ canonical: "", variant: "" });
  const [msg, setMsg] = useState("");
  const load = async () => setPairs((await library.nameVariants.list()).sort((a, b) => a.canonical.localeCompare(b.canonical) || a.variant.localeCompare(b.variant)));
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, [library]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    try {
      const r = await library.nameVariants.add({ canonical: form.canonical.trim(), variant: form.variant.trim(), origin: "manual" });
      setMsg(`Paired: ${r.canonical} – ${r.variant}.`); setForm({ canonical: "", variant: "" }); await load();
    } catch (e) { setMsg(e.message); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Remove the pair ${p.canonical} – ${p.variant}? Search and matching will no longer treat them as one name.`)) return;
    await library.nameVariants.remove(p.id);
    await library.searchIndex.remove();   // rebuilt without the pair at the next search
    setMsg(`Removed: ${p.canonical} – ${p.variant}.`); await load();
  };
  const shown = (pairs ?? []).filter((p) => !filter.trim() || fold(`${p.canonical} ${p.variant}`).includes(fold(filter.trim())));

  return (
    <div data-testid="name-variants" style={{ marginTop: 16 }}>
      <div style={{ font: "700 13px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Name variants</div>
      <div style={small}>
        Spellings and language forms of one name (Ioan – Iohannes, Hariton – Haritonu). Search and Matches treat a pair as
        one name, one step only (Ion – Ioan and Ioan – Iohannes do not make Ion – Iohannes). A pair is about spelling, never
        a decision that two people are the same.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
        <input aria-label="Name" placeholder="name, e.g. Ioan" value={form.canonical} onChange={(e) => setForm({ ...form, canonical: e.target.value })} style={{ ...input, width: 150 }} />
        <span style={small}>–</span>
        <input aria-label="Variant" placeholder="variant, e.g. Iohannes" value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} style={{ ...input, width: 150 }} />
        <button style={mini} disabled={!form.canonical.trim() || !form.variant.trim()} onClick={add}>Add pair</button>
        <input aria-label="Filter pairs" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...input, width: 120, marginLeft: "auto" }} />
      </div>
      {msg && <div role="status" style={{ ...small, color: C.ink }}>{msg}</div>}
      {pairs && !pairs.length && <div style={small}>No pairs yet.</div>}
      <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, maxHeight: 260, overflowY: "auto" }}>
        {shown.map((p) => (
          <li key={p.id} data-testid="variant-pair" style={{ ...small, color: C.ink, display: "flex", gap: 8, alignItems: "center", borderTop: `1px solid ${C.ruleFaint}`, padding: "2px 0" }}>
            <span style={{ flex: 1 }}>{p.canonical} – {p.variant}</span>
            <span style={small}>{p.origin === "learned" ? "learned from Matches" : "yours"}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ""}</span>
            <button style={mini} aria-label={`Remove ${p.canonical} – ${p.variant}`} onClick={() => remove(p)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
