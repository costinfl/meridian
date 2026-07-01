import { createEvent, createPeriod, createGroup, createSource } from "./models/project.js";

/* ============================================================
   GEDCOM 5.5.1 — standard, verified-only export + import.

   Export writes the family skeleton (INDI name/sex + FAM links) for every
   person, but includes a *fact* (birth, death, event, role, group, source
   citation) only when it is explicitly marked `verified`. Non-standard
   constructs (event-group bands, and project-level eras/brackets) either map
   to standard NOTE lines or are omitted — never custom `_` tags.
   ============================================================ */

const MAX_LINE = 200; // conservative value length before CONC wrapping

// Emit a possibly long / multi-line value using CONT (newlines) and CONC (length).
function pushText(L, level, tag, value) {
  const paras = String(value ?? "").split(/\r?\n/);
  paras.forEach((para, pi) => {
    let start = 0, firstChunk = true;
    do {
      const chunk = para.slice(start, start + MAX_LINE);
      start += MAX_LINE;
      if (pi === 0 && firstChunk) L.push(`${level} ${tag} ${chunk}`);
      else if (firstChunk) L.push(`${level + 1} CONT ${chunk}`);
      else L.push(`${level + 1} CONC ${chunk}`);
      firstChunk = false;
    } while (start < para.length);
    if (para.length === 0 && pi > 0) L.push(`${level + 1} CONT`);
  });
}

export function exportGedcom(people, { sources = [] } = {}) {
  const L = ["0 HEAD", "1 SOUR MERIDIAN", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8"];
  const sourceById = Object.fromEntries(sources.map((s) => [s.id, s]));

  // xref for every verified source (records emitted only if actually cited)
  const srcXref = new Map();
  let sn = 0;
  sources.forEach((s) => { if (s.verified) srcXref.set(s.id, `S${++sn}`); });
  const usedSources = new Set();

  const famKey = (f, m) => `${f || ""}|${m || ""}`;
  const fams = new Map();
  people.forEach((p) => {
    if (p.fatherId || p.motherId) {
      const k = famKey(p.fatherId, p.motherId);
      if (!fams.has(k)) fams.set(k, { husb: p.fatherId, wife: p.motherId, chil: [] });
      fams.get(k).chil.push(p.id);
    }
  });
  people.forEach((p) => (p.spouseIds || []).forEach((s) => {
    const a = p.sex === "F" ? s : p.id, b = p.sex === "F" ? p.id : s;
    const k = famKey(a, b);
    if (!fams.has(k)) fams.set(k, { husb: a, wife: b, chil: [] });
  }));
  const famIds = new Map([...fams.keys()].map((k, i) => [k, `F${i + 1}`]));

  // cite a source under the current item, if both item and source are verified
  const cite = (sourceId) => {
    if (sourceId && srcXref.has(sourceId)) {
      usedSources.add(sourceId);
      L.push(`2 SOUR @${srcXref.get(sourceId)}@`);
    }
  };

  people.forEach((p) => {
    const parts = p.name.replace(/\s*\(b\..*\)$/, "").trim().split(" ");
    const surname = parts.pop() || "";
    L.push(`0 @${p.id.toUpperCase()}@ INDI`, `1 NAME ${parts.join(" ")} /${surname}/`, `1 SEX ${p.sex || "U"}`);

    if (p.birth?.year && p.birth.verified) { L.push("1 BIRT", `2 DATE ${p.birth.year}`); if (p.birth.place) L.push(`2 PLAC ${p.birth.place}`); }
    if (p.death?.year && p.death.verified) { L.push("1 DEAT", `2 DATE ${p.death.year}`); if (p.death.place) L.push(`2 PLAC ${p.death.place}`); }

    // roles / occupations → OCCU with a date range
    (p.periods || []).filter((r) => r.verified).forEach((r) => {
      L.push(`1 OCCU ${r.label}`, `2 DATE FROM ${r.start} TO ${r.end}`);
      if (r.note) pushText(L, 2, "NOTE", r.note);
      cite(r.sourceId);
    });

    // events → generic EVEN + TYPE
    (p.events || []).filter((e) => e.verified).forEach((e) => {
      L.push(`1 EVEN ${e.label}`, `2 TYPE ${e.type || "note"}`, `2 DATE ${e.year}`);
      if (e.note) pushText(L, 2, "NOTE", e.note);
      cite(e.sourceId);
    });

    // event-group bands → standard NOTE (no standard tag exists)
    (p.groups || []).filter((g) => g.verified).forEach((g) => {
      pushText(L, 1, "NOTE", `${g.label} (${g.start}–${g.end})${g.note ? ". " + g.note : ""}`);
      cite(g.sourceId);
    });

    const k = famKey(p.fatherId, p.motherId);
    if ((p.fatherId || p.motherId) && famIds.has(k)) L.push(`1 FAMC @${famIds.get(k)}@`);
    fams.forEach((f, kk) => { if (f.husb === p.id || f.wife === p.id) L.push(`1 FAMS @${famIds.get(kk)}@`); });
  });

  fams.forEach((f, k) => {
    L.push(`0 @${famIds.get(k)}@ FAM`);
    if (f.husb) L.push(`1 HUSB @${f.husb.toUpperCase()}@`);
    if (f.wife) L.push(`1 WIFE @${f.wife.toUpperCase()}@`);
    f.chil.forEach((c) => L.push(`1 CHIL @${c.toUpperCase()}@`));
  });

  // source records for the verified sources actually cited above
  usedSources.forEach((id) => {
    const s = sourceById[id];
    if (!s) return;
    L.push(`0 @${srcXref.get(id)}@ SOUR`);
    if (s.title) pushText(L, 1, "TITL", s.title);
    if (s.repository) pushText(L, 1, "PUBL", s.repository);
    if (s.citation) pushText(L, 1, "TEXT", s.citation); // APA7 reference
  });

  L.push("0 TRLR");
  return L.join("\n");
}

export function parseGedcom(text) {
  const people = [];
  const sourceRecords = {}; // xref -> createSource() object
  let cur = null;    // current INDI person
  let sub = null;    // current level-1 substructure { tag, ... }
  let curSrc = null; // current level-0 SOUR record
  let last = null;   // { obj, key } target for CONC/CONT continuation

  const flushSub = () => {
    if (cur && sub) {
      if (sub.tag === "OCCU") {
        const r = createPeriod({ start: sub.start ?? sub.year, end: sub.end ?? sub.year, label: sub.label || "", note: sub.note || "" });
        r._srcXref = sub.srcXref; cur.periods.push(r);
      } else if (sub.tag === "EVEN") {
        const e = createEvent({ year: sub.year, label: sub.label || "", type: sub.type || "note", note: sub.note || "" });
        e._srcXref = sub.srcXref; cur.events.push(e);
      } else if (sub.tag === "NOTE") {
        const m = String(sub.text || "").match(/^(.*?)\s*\((\d{3,4})\s*[–-]\s*(\d{3,4})\)\s*\.?\s*(.*)$/);
        if (m) cur.groups.push(createGroup({ start: +m[2], end: +m[3], label: m[1].trim(), note: m[4].trim() }));
      }
    }
    sub = null;
  };

  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^(\d+)\s+(@[^@]+@\s+)?(\S+)(\s+(.*))?$/);
    if (!m) return;
    const lvl = +m[1], xref = m[2]?.trim().replace(/@/g, ""), tag = m[3], val = m[5] || "";

    if (lvl === 0) {
      flushSub();
      if (cur) { people.push(cur); cur = null; }
      curSrc = null; last = null;
      if (tag === "INDI") {
        cur = { id: "imp_" + (xref || people.length), name: "Unnamed", sex: "U", birth: {}, death: {}, events: [], periods: [], groups: [], media: [], spouseIds: [] };
      } else if (tag === "SOUR" && xref) {
        curSrc = createSource({ title: "Untitled source" });
        sourceRecords[xref] = curSrc;
      }
      return;
    }

    // ---- inside a SOUR record ----
    if (curSrc) {
      if (tag === "TITL") { curSrc.title = val; last = { obj: curSrc, key: "title" }; }
      else if (tag === "PUBL") { curSrc.repository = val; last = { obj: curSrc, key: "repository" }; }
      else if (tag === "TEXT") { curSrc.citation = val; last = { obj: curSrc, key: "citation" }; }
      else if (tag === "CONT" && last) { last.obj[last.key] = (last.obj[last.key] || "") + "\n" + val; }
      else if (tag === "CONC" && last) { last.obj[last.key] = (last.obj[last.key] || "") + val; }
      return;
    }

    if (!cur) return;

    if (lvl === 1) {
      flushSub();
      last = null;
      if (tag === "NAME") { cur.name = val.replace(/\//g, "").trim() || cur.name; }
      else if (tag === "SEX") { cur.sex = val.trim() || cur.sex; }
      else if (tag === "BIRT") sub = { tag: "BIRT" };
      else if (tag === "DEAT") sub = { tag: "DEAT" };
      else if (tag === "OCCU") sub = { tag: "OCCU", label: val };
      else if (tag === "EVEN") sub = { tag: "EVEN", label: val };
      else if (tag === "NOTE") { sub = { tag: "NOTE", text: val }; last = { obj: sub, key: "text" }; }
      // FAMC / FAMS intentionally ignored (relationships not reconstructed here)
      return;
    }

    if (lvl >= 2 && sub) {
      if (tag === "DATE") {
        if (sub.tag === "BIRT" || sub.tag === "DEAT") {
          const y = val.match(/\d{3,4}/);
          if (y) cur[sub.tag === "BIRT" ? "birth" : "death"].year = +y[0];
        } else if (sub.tag === "OCCU") {
          const range = val.match(/FROM\s+(\d{3,4}).*?TO\s+(\d{3,4})/i);
          if (range) { sub.start = +range[1]; sub.end = +range[2]; }
          else { const y = val.match(/\d{3,4}/); if (y) { sub.start = +y[0]; sub.end = +y[0]; } }
        } else if (sub.tag === "EVEN") {
          const y = val.match(/\d{3,4}/); if (y) sub.year = +y[0];
        }
      } else if (tag === "PLAC") {
        if (sub.tag === "BIRT" || sub.tag === "DEAT") cur[sub.tag === "BIRT" ? "birth" : "death"].place = val;
      } else if (tag === "TYPE" && sub.tag === "EVEN") { sub.type = val.trim(); }
      else if (tag === "NOTE") { sub.note = val; last = { obj: sub, key: "note" }; }
      else if (tag === "SOUR") { sub.srcXref = val.replace(/@/g, "").trim(); }
      else if (tag === "CONT" && last) { last.obj[last.key] = (last.obj[last.key] || "") + "\n" + val; }
      else if (tag === "CONC" && last) { last.obj[last.key] = (last.obj[last.key] || "") + val; }
      return;
    }
  });
  flushSub();
  if (cur) people.push(cur);

  // resolve source citations (xref -> source.id) and collect referenced sources
  const usedSources = new Set();
  people.forEach((p) => {
    [...(p.events || []), ...(p.periods || []), ...(p.groups || [])].forEach((it) => {
      if (it._srcXref && sourceRecords[it._srcXref]) {
        it.sourceId = sourceRecords[it._srcXref].id;
        usedSources.add(sourceRecords[it._srcXref]);
      }
      delete it._srcXref;
    });
  });
  const sources = [...new Set([...Object.values(sourceRecords), ...usedSources])];

  // keep genuine individuals (a real name or any dated fact)
  const keep = people.filter((p) => (p.name && p.name !== "Unnamed") || p.birth?.year || p.death?.year || p.events.length || p.periods.length);
  return { people: keep, sources };
}
