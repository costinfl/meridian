import React, { useEffect, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { getTranskribusSettings, saveTranskribusSettings, sessionClient, DEFAULT_BASE_URL } from "../../ingest/transkribus/index.js";

// Transkribus account (Phase 9 review, d). The user name and model are kept on this device only; the password is
// asked for each browser session and never stored. "Read with Transkribus" in Review text uses them.
const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "3px 6px" };

export default function TranskribusSettings({ storage, client: clientProp = null }) {
  const [s, setS] = useState(null);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  useEffect(() => { getTranskribusSettings(storage).then(setS).catch((e) => setMsg(e.message)); }, [storage]);
  if (!s) return null;
  const client = clientProp ?? sessionClient(s.baseUrl || DEFAULT_BASE_URL);
  const save = async (patch) => setS(await saveTranskribusSettings(storage, patch));
  const signIn = async () => {
    setBusy(true); setMsg("");
    try { await save({ username: s.username }); await client.signIn(s.username.trim(), password); setPassword(""); setMsg(`Signed in as ${s.username.trim()} for this browser session.`); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); force((n) => n + 1); }
  };
  return (
    <div data-testid="transkribus-settings" style={{ marginTop: 16 }}>
      <div style={{ font: "700 13px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Transkribus account</div>
      <div style={small}>
        <strong>Read with Transkribus</strong> (in Review text) sends a page image to Transkribus with the model you choose and
        imports its text. It needs a Transkribus account on a plan that includes the processing API, and uses its credits.
        Your password is asked once per browser session and never stored.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
        <input aria-label="Transkribus user name" placeholder="user name (e-mail)" value={s.username} onChange={(e) => setS({ ...s, username: e.target.value })} style={{ ...input, width: 220 }} />
        {client.signedIn ? (
          <>
            <span data-testid="transkribus-status" style={{ ...small, color: C.ink }}>Signed in as {client.signedIn.username}</span>
            <button style={mini} onClick={() => { client.signOut(); setMsg("Signed out."); force((n) => n + 1); }}>Sign out</button>
          </>
        ) : (
          <>
            <input aria-label="Transkribus password" type="password" placeholder="password (not stored)" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, width: 180 }} />
            <button style={mini} disabled={busy || !s.username.trim() || !password} onClick={signIn}>Sign in</button>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...small }}>
        <label>Text recognition model id <input aria-label="Transkribus model id" placeholder="e.g. 579509" value={s.htrId} onChange={(e) => setS({ ...s, htrId: e.target.value.replace(/\D/g, "") })} onBlur={() => save({ htrId: s.htrId })} style={{ ...input, width: 90 }} /></label>
        <a href="https://www.transkribus.org/models" target="_blank" rel="noreferrer" style={{ color: C.slate }}>find models</a>
        <label><input type="checkbox" checked={!!s.languageModel} onChange={(e) => save({ languageModel: e.target.checked })} /> use the model's language model</label>
      </div>
      <details style={{ ...small, marginTop: 4 }}>
        <summary style={{ cursor: "pointer" }}>Advanced</summary>
        <label>Line detection model id (optional) <input aria-label="Transkribus line model id" value={s.lineModelId} onChange={(e) => setS({ ...s, lineModelId: e.target.value.replace(/\D/g, "") })} onBlur={() => save({ lineModelId: s.lineModelId })} style={{ ...input, width: 90 }} /></label>{" "}
        <label>API address <input aria-label="Transkribus API address" value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} onBlur={() => save({ baseUrl: s.baseUrl.trim() || DEFAULT_BASE_URL })} style={{ ...input, width: 300 }} /></label>
      </details>
      {msg && <div role="status" style={{ ...small, color: C.ink, marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
