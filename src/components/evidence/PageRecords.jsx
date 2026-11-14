import React, { useCallback, useEffect, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { recordsOfPage } from "../../evidence/index.js";
import ManualRecordForm from "./ManualRecordForm.jsx";
import RecordsTab from "./RecordsTab.jsx";

// The Records tab of the page workspace: regions, manual entry and the records found on this page.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const toggle = (on) => ({ ...btnStyle(on), padding: "2px 8px", fontSize: 11 });

/**
 * @param {{ library, page, regions, selectedRegionId, onSelectRegion, drawing, onDrawing, imageUrl, extra?: (ctx) => React.ReactNode,
 *           renderActions?, renderRecordActions?, renderCrop?, version?: number }} props
 */
export default function PageRecords({ library, page, regions, selectedRegionId, onSelectRegion, drawing, onDrawing, renderActions, renderRecordActions, renderCrop, version = 0, extra }) {
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

  const saved = async (r) => {
    setEntering(false);
    await load();
    setMessage(`Saved: ${r.record.kind} record with ${r.personas.length} people and ${r.assertions.length} confirmed values.`);
  };

  return (
    <div data-testid="page-records">
      <div style={{ ...small, marginBottom: 6 }}>
        Draw a region around one entry on the image (or use the whole page), then type its record or let AI extract it.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button style={toggle(drawing)} aria-pressed={drawing} onClick={() => onDrawing(!drawing)}>{drawing ? "Drawing… (drag on the image)" : "Draw region"}</button>
        <span style={small}>Working on: <strong style={{ color: C.ink }}>{targetLabel}</strong></span>
        {selected && <button style={mini} onClick={() => onSelectRegion(null)}>Use whole page</button>}
        {!entering && target && <button style={mini} onClick={() => { setEntering(true); setMessage(""); }}>New record…</button>}
        {extra?.({ target, targetLabel, reload: load, setMessage })}
      </div>
      {entering && target && <ManualRecordForm library={library} regionId={target.id} regionLabel={targetLabel} onSaved={saved} onCancel={() => setEntering(false)} />}
      {message && <div role="status" data-testid="records-status" style={{ ...small, color: message.startsWith("Failed") || message.startsWith("Not") ? C.focus : C.ink, margin: "6px 0" }}>{message}</div>}
      <div style={{ marginTop: 8 }}>
        <RecordsTab items={items} selectedRegionId={selectedRegionId} onSelectRegion={onSelectRegion}
          renderActions={renderActions ? (a, item) => renderActions(a, item, { reload: load, setMessage }) : undefined}
          renderRecordActions={renderRecordActions ? (item) => renderRecordActions(item, { reload: load, setMessage }) : undefined}
          renderCrop={renderCrop} />
      </div>
    </div>
  );
}
