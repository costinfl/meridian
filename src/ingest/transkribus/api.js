// Transkribus processing API ("metagrapho") from the browser (Phase 9 review, d). Sign-in goes to the READ-COOP
// account server (OpenID Connect, password grant, client "processing-api-client"); tokens are kept in memory for this
// session only, the password is never stored. A page image is sent as base64 with the chosen text recognition model;
// the job is polled until it finishes; the result is PAGE XML, imported like a Transkribus export (Phase 7b).
//
// Endpoints (checked 2026-11-19): API v1 at transkribus.eu/processing/v1 ("Transkribus Metagrapho API" 1.13.1),
// which accepts calls from the browser (CORS). The newer v2 at api-staging.transkribus.org does not answer the
// browser's CORS check yet; the base URL is a setting so it can be switched when it does.

export const TOKEN_URL = "https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token";
export const CLIENT_ID = "processing-api-client";
export const DEFAULT_BASE_URL = "https://transkribus.eu/processing/v1";
export const TERMINAL = new Set(["FINISHED", "FAILED", "CANCELLED"]);

export class TranskribusError extends Error {
  constructor(message, { status = 0, code = "" } = {}) { super(message); this.name = "TranskribusError"; this.status = status; this.code = code; }
}

const explain = (status, body) => {
  if (status === 401) return "Transkribus did not accept the sign-in (wrong user name or password, or the session expired). Sign in again in Settings & tools.";
  if (status === 403) return "Your Transkribus account may not use the processing API (it needs a Scholar plan or above).";
  if (status === 429) return "Transkribus refused the job: no credits left, or too many requests. Try again later.";
  if (status === 404) return "Transkribus does not know this model or job (check the model id).";
  return `Transkribus answered ${status}${body ? `: ${String(body).slice(0, 200)}` : ""}`;
};

/** Base64 of bytes (Uint8Array), in chunks so large images do not overflow the call stack. */
export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * @param {{ baseUrl?, fetchImpl?, now?, sleep? }} opts
 */
export function createTranskribusClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let session = null;   // { username, access, refresh, accessUntil, refreshUntil }

  async function tokenRequest(form) {
    const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, ...form }).toString() });
    if (!res.ok) throw new TranskribusError(res.status === 400 || res.status === 401 ? "Transkribus did not accept the user name or password." : explain(res.status, await res.text().catch(() => "")), { status: res.status });
    const t = await res.json();
    const at = now();
    return { access: t.access_token, refresh: t.refresh_token, accessUntil: at + (t.expires_in ?? 300) * 1000 - 15000, refreshUntil: at + (t.refresh_expires_in ?? 1800) * 1000 - 15000 };
  }
  async function token() {
    if (!session) throw new TranskribusError("Sign in to Transkribus first (Settings & tools).", { code: "signed-out" });
    if (now() < session.accessUntil) return session.access;
    if (now() < session.refreshUntil) { session = { ...session, ...(await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refresh })) }; return session.access; }
    session = null;
    throw new TranskribusError("The Transkribus session expired. Sign in again in Settings & tools.", { code: "signed-out" });
  }
  async function api(path, { method = "GET", body, accept = "application/json" } = {}) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method, headers: { Authorization: `Bearer ${await token()}`, Accept: accept, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new TranskribusError(explain(res.status, await res.text().catch(() => "")), { status: res.status });
    return accept === "application/json" ? res.json() : res.text();
  }

  return {
    get signedIn() { return session ? { username: session.username } : null; },
    async signIn(username, password) {
      if (!username || !password) throw new TranskribusError("User name and password are needed.");
      session = { username, ...(await tokenRequest({ grant_type: "password", username, password })) };
      return { username };
    },
    signOut() { session = null; },
    /** Submit one image. Returns { processId, status }. */
    async submit({ bytes, htrId, languageModel = false, lineModelId = null }) {
      if (!Number.isInteger(Number(htrId)) || !Number(htrId)) throw new TranskribusError("Choose a text recognition model id (Settings & tools).", { code: "no-model" });
      const config = { textRecognition: { htrId: Number(htrId), ...(languageModel ? { languageModel: "built-in" } : {}) }, ...(lineModelId ? { lineDetection: { modelId: Number(lineModelId) } } : {}) };
      const r = await api("/processes", { method: "POST", body: { config, image: { base64: toBase64(bytes) } } });
      return { processId: r.processId, status: r.status };
    },
    status: (processId) => api(`/processes/${processId}`),
    pageXml: (processId) => api(`/processes/${processId}/page`, { accept: "application/xml" }),
    /** Poll until the job ends (every `interval` ms, at most `timeout`). Returns the final status object. */
    async wait(processId, { interval = 4000, timeout = 10 * 60 * 1000, signal, onStatus } = {}) {
      const start = now();
      for (;;) {
        if (signal?.aborted) throw new TranskribusError("Stopped.", { code: "aborted" });
        const s = await api(`/processes/${processId}`);
        onStatus?.(s.status);
        if (TERMINAL.has(s.status)) return s;
        if (now() - start > timeout) throw new TranskribusError("Transkribus is taking too long; try again later.", { code: "timeout" });
        await sleep(interval);
      }
    },
  };
}

// one client per base URL for the whole page session: the sign-in lasts until the tab is closed
const clients = new Map();
export function sessionClient(baseUrl = DEFAULT_BASE_URL) {
  if (!clients.has(baseUrl)) clients.set(baseUrl, createTranskribusClient({ baseUrl }));
  return clients.get(baseUrl);
}
