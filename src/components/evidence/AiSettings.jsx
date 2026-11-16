import React, { useEffect, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { getAiSettings, saveAiSettings, maskKey, PROVIDERS } from "../../extract/settings.js";

// AI settings (P6.T3): which provider reads pages, which model, your API key, and how many pages one batch may
// send. Everything is kept on this device only (never in projects, bundles or exports).

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const primary = { ...btnStyle(true), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px", boxSizing: "border-box" };

export default function AiSettings({ storage }) {
  const [s, setS] = useState(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { getAiSettings(storage).then((v) => { setS(v); setModelDraft(v.models[v.provider]); }).catch(() => {}); }, [storage]);
  if (!s) return null;
  const p = s.provider, info = PROVIDERS[p];

  const save = async (patch, msg) => {
    try { const next = await saveAiSettings(storage, patch); setS(next); setMessage(msg); return next; }
    catch (e) { setMessage(`Not saved: ${e.message}`); return null; }
  };
  const choose = async (provider) => { const next = await save({ provider }, ""); if (next) { setModelDraft(next.models[provider]); setKeyDraft(""); } };

  return (
    <div data-testid="ai-settings" style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.rule}` }}>
      <div style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>AI settings</div>
      <div style={small}>
        <strong>Extract records</strong> and <strong>Read with AI</strong> send the page image and its text to the provider you choose,
        using your own API key (you pay the provider). The key is stored only in this browser on this device: it is never
        exported, shared or included in backups.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <label style={small}>Provider{" "}
          <select aria-label="AI provider" value={p} onChange={(e) => choose(e.target.value)} style={input}>
            {Object.entries(PROVIDERS).map(([id, v]) => <option key={id} value={id}>{v.label}</option>)}
          </select>
        </label>
        <label style={small}>Model{" "}
          <input aria-label="AI model" list={`models-${p}`} value={modelDraft} placeholder={p === "openai" ? "type the model name" : ""} onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => modelDraft.trim() !== s.models[p] && save({ models: { [p]: modelDraft.trim() } }, "Model saved.")} style={{ ...input, width: 170 }} />
          <datalist id={`models-${p}`}>{info.models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label style={small}>Pages per batch{" "}
          <input aria-label="Pages per batch" type="number" min={1} max={200} value={s.maxPages} onChange={(e) => save({ maxPages: Number(e.target.value) }, "Page limit saved.")} style={{ ...input, width: 56 }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        {s.keys[p] ? (
          <>
            <span style={small}>{info.label} key: <code data-testid="saved-key">{maskKey(s.keys[p])}</code></span>
            <button style={mini} onClick={() => save({ keys: { [p]: "" } }, "Key removed from this device.")}>Remove key</button>
          </>
        ) : (
          <>
            <input aria-label={`${info.label} API key`} type="password" autoComplete="off" placeholder={info.keyHint} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} style={{ ...input, width: 220 }} />
            <button style={primary} disabled={!keyDraft.trim()} onClick={async () => { if (await save({ keys: { [p]: keyDraft.trim() } }, "Key saved on this device.")) setKeyDraft(""); }}>Save key</button>
          </>
        )}
      </div>
      {message && <div role="status" data-testid="ai-settings-status" style={{ ...small, color: message.startsWith("Not") ? C.focus : C.ink, marginTop: 4 }}>{message}</div>}
    </div>
  );
}
