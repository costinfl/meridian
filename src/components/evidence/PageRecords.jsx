import React, { useCallback, useEffect, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { recordsOfPage } from "../../evidence/index.js";
import ManualRecordForm from "./ManualRecordForm.jsx";
import RecordsTab from "./RecordsTab.jsx";
import { ReviewActions, ConfirmAll, RecordCrop } from "./AssertionReview.jsx";

// The Records tab of the page workspace: regions, manual entry and the records found on this page.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const toggle = (on) => ({ ...btnStyle(on), padding: "2px 8px", fontSize: 11 });

/**
 * @param {{ library, page, regions, selectedRegionId, onSelectRegion, drawing, onDrawing, imageUrl, extra?: (ctx) => React.ReactNode, version?: number }} props
 */
export default function PageRecords({ library, page, regions, selectedRegionId, onSelectRegion, drawing, onDrawing, imageUrl, version = 0, extra }) {
  const [items, setItems] = useState([]);
  const [entering, setEntering] = useState(false);
  const [message, setMessage] = useState("");
  const whole = regions.find((r) => r.kind === "page") ?? null;
  const selected = regions.find((r) => r.id === selectedRegionId) ?? null;
  const target = selected ?? whole;
  const targetLabel = selected ? (selected.label || "the selected region") : "the whole page";

  const load = useCallback(async () => { if (page) setItems(await recordsOfPage(library, page.id)); }, [library, page]);
  useEffect(() => { load().catch((e) => setMessage(`Failed: ${e.message}`)); }, [load, version]);
  useEffect(() => { setEntering(false); }, [page]);

  const reviewed = async (msg) => { await load(); setMessage(msg); };
  const saved = async (r) => {
    setEntering(false);
    await load();
    setMessage(`Saved: ${r.record.kind} record with ${r.personas.length} people and ${r.assertions.length} confirmed values.`);
  };

  return (
    <div data-testid="page-records">
      <div style={{ ...small, marginBottom: 6 }}>
        Draw a box around one entry, or around a stamp or margin note (later events such as a marriage, adoption, death or
        divorce are often noted there), then type its record. If it is very hard to read, <strong>Extract with AI</strong> reads only that box.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button style={toggle(drawing === "entry")} aria-pressed={drawing === "entry"} onClick={() => onDrawing(drawing === "entry" ? false : "entry")}>{drawing === "entry" ? "Drawing… (drag on the image)" : "Draw entry box"}</button>
        <button style={toggle(drawing === "annotation")} aria-pressed={drawing === "annotation"} onClick={() => onDrawing(drawing === "annotation" ? false : "annotation")}>{drawing === "annotation" ? "Drawing… (drag on the image)" : "Draw stamp / margin note"}</button>
        <span style={small}>Working on: <strong style={{ color: C.ink }}>{targetLabel}</strong></span>
        {selected && <button style={mini} onClick={() => onSelectRegion(null)}>Use whole page</button>}
        {!entering && target && <button style={mini} onClick={() => { setEntering(true); setMessage(""); }}>New record…</button>}
        {extra?.({ target, targetLabel, reload: load, setMessage })}
      </div>
      {entering && target && <ManualRecordForm library={library} regionId={target.id} regionLabel={targetLabel} onSaved={saved} onCancel={() => setEntering(false)} />}
      {message && <div role="status" data-testid="records-status" style={{ ...small, color: message.startsWith("Failed") || message.startsWith("Not") ? C.focus : C.ink, margin: "6px 0" }}>{message}</div>}
      <div style={{ marginTop: 8 }}>
        {items.some((i) => i.counts.proposed) && <div style={{ ...small, marginBottom: 6 }}>Check each proposed value against the image: <strong>Confirm</strong>, <strong>Reject</strong> (it will not be proposed again) or <strong>Correct</strong>.</div>}
        <RecordsTab items={items} selectedRegionId={selectedRegionId} onSelectRegion={onSelectRegion}
          renderActions={(a) => <ReviewActions library={library} assertion={a} onDone={reviewed} />}
          renderRecordActions={(item) => <ConfirmAll library={library} item={item} onDone={reviewed} />}
          renderCrop={(item) => <RecordCrop imageUrl={imageUrl} item={item} page={page} />} />
      </div>
    </div>
  );
}
