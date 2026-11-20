import React, { useState } from "react";
import { C, btnStyle } from "../theme.js";
import { Modal } from "./Modal.jsx";

// Places of the context lanes (context lanes B3): each place of the people on the board, the Wikidata item it was
// matched to, and the countries it belonged to over the years; change the match, or say it is no place on Wikidata.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "3px 6px" };

function ChangePlace({ place, wikidata, onChoose }) {
  const [q, setQ] = useState(place);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const search = async () => {
    setBusy(true); setErr("");
    try { setFound(await wikidata.searchPlace(q)); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ margin: "4px 0 0 12px" }}>
      <input aria-label={`Search Wikidata for ${place}`} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, width: 200 }} />{" "}
      <button style={mini} disabled={busy || !q.trim() || !wikidata} onClick={search}>Search</button>
      {err && <span style={{ ...small, color: C.focus }}> {err}</span>}
      {found && (
        <ul style={{ listStyle: "none", margin: "4px 0", padding: 0 }}>
          {found.map((f) => (
            <li key={f.qid}><button style={{ ...mini, border: "none", textAlign: "left" }} onClick={() => onChoose({ qid: f.qid, label: f.label, description: f.description, country: f.country ?? "", auto: false })}>
              {f.label} <span style={small}>— {f.description || f.qid}{f.settlement ? "" : " (not a settlement)"}</span></button></li>
          ))}
          {!found.length && <li style={small}>Nothing found.</li>}
        </ul>
      )}
    </div>
  );
}

/** @param {{ lanes, resolved, wikidata, error, onChoose: (placeKey, choice | "none") => void, onClose }} props */
export default function PlacesPanel({ lanes, resolved, wikidata, error, onChoose, onClose, notablePeople = false, onToggleNotable, onRefresh }) {
  const [refreshed, setRefreshed] = useState("");
  const [changing, setChanging] = useState(null);
  const local = lanes.find((l) => l.id === "local");
  const national = lanes.find((l) => l.id === "national");
  return (
    <Modal title="Places of the context lanes" onClose={onClose} width={620}>
      <div data-testid="places-panel">
        <div style={small}>
          The places where the people on the board lived (from their births, deaths, life events and roles). Each is matched to
          a place on Wikidata, whose history and country over the years fill the Local and National lanes. Only place names
          and years are sent to Wikidata.{!wikidata && " The context source is Built-in only: nothing is looked up."}
        </div>
        {error && <div role="alert" style={{ ...small, color: C.focus, marginTop: 4 }}>{error}</div>}
        {wikidata && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "8px 0 0" }}>
            <label style={{ ...small, color: C.ink }}>
              <input type="checkbox" checked={notablePeople} onChange={(e) => onToggleNotable?.(e.target.checked)} />{" "}
              Show notable people of these places <span style={small}>(born or died there, from Wikidata; looked up only while this is on)</span>
            </label>
            <button style={mini} onClick={async () => { setRefreshed("Looking everything up again…"); await onRefresh?.(); setRefreshed("History refreshed: new answers replace the old ones as they arrive."); }}
              title="Look everything up again on Wikidata instead of using what this device remembers (your place matches are kept)">Refresh history</button>
            {refreshed && <span role="status" style={small}>{refreshed}</span>}
          </div>
        )}
        <ul style={{ listStyle: "none", margin: "8px 0", padding: 0 }}>
          {(local?.chips ?? []).map((c) => {
            const r = resolved[c.key];
            return (
              <li key={c.key} data-testid="place-row" style={{ borderTop: `1px solid ${C.rule}`, padding: "6px 0" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                  <strong style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink }}>{c.title || c.label}</strong>
                  <span style={small}>{c.people.join(", ")}</span>
                  <span style={{ ...small, color: C.ink }}>
                    {r === "none" ? "not matched (you chose none)" : r ? <>→ <a href={`https://www.wikidata.org/wiki/${r.qid}`} target="_blank" rel="noreferrer" style={{ color: C.slate }}>{r.label}</a> — {r.description || r.qid}{r.auto ? " (found automatically)" : ""}</> : wikidata ? "looking up…" : "not looked up"}
                  </span>
                  {wikidata && <button style={mini} onClick={() => setChanging(changing === c.key ? null : c.key)}>Change…</button>}
                  {r !== "none" && <button style={mini} onClick={() => onChoose(c.key, "none")} title="No Wikidata place: only your own and built-in events">None</button>}
                </div>
                {changing === c.key && <ChangePlace place={c.title || c.label} wikidata={wikidata} onChoose={(choice) => { onChoose(c.key, choice); setChanging(null); }} />}
              </li>
            );
          })}
          {!local?.chips.length && <li style={small}>No places yet: add birth places, or places on life events and roles.</li>}
        </ul>
        {national?.chips.length > 0 && (
          <div style={small}>
            <strong style={{ color: C.ink }}>Countries at the time:</strong>{" "}
            {national.chips.map((c) => `${c.label} (${c.title})`).join("; ")}
          </div>
        )}
      </div>
    </Modal>
  );
}
