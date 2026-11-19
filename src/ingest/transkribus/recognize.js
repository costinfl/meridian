// Read pages with the Transkribus API (Phase 9 review, d): for each page, send its image, wait, fetch the PAGE XML
// and import it as a new transcription (the Phase 7b importer: one `transkribus` run, the XML kept as raw output,
// lines kept as positioned words). Automated code: it adds transcriptions only (I6).
import { parsePageXml } from "./pageXml.js";
import { importTranskribus } from "./importer.js";
import { DEFAULT_BASE_URL } from "./api.js";

export const SETTINGS_KEY = "transkribus";
export const DEFAULT_SETTINGS = { username: "", htrId: "", languageModel: false, lineModelId: "", baseUrl: DEFAULT_BASE_URL };

/** Device-only settings (never in the project or bundles). The password is never stored. */
export async function getTranskribusSettings(storage) {
  const s = (await storage.getSetting?.(SETTINGS_KEY)) ?? {};
  return { ...DEFAULT_SETTINGS, ...s };
}
export async function saveTranskribusSettings(storage, patch) {
  const next = { ...(await getTranskribusSettings(storage)), ...patch };
  delete next.password;
  await storage.putSetting(SETTINGS_KEY, next);
  return next;
}

/** What is missing before pages can be sent (or ""). */
export function transkribusMissing(settings, client) {
  if (!client?.signedIn) return "Sign in to Transkribus in Evidence → Settings & tools.";
  if (!String(settings.htrId ?? "").trim()) return "Choose a text recognition model id in Settings & tools.";
  return "";
}

/**
 * @param {object} a
 * @param {object} a.library
 * @param {object} a.client      createTranskribusClient(...) (signed in)
 * @param {object} a.settings    getTranskribusSettings(...)
 * @param {{ page, copy }[]} a.pages
 * @param {(page) => Promise<{ bytes, mimeType, width, height }>} a.loadImage   the page image (cached render)
 * @returns {Promise<{ runId, imported, skipped, failed: [{ file, error }], processes: [{ pageId, processId, status }] }>}
 */
export async function recognizePages({ library, client, settings, pages, loadImage, signal, onProgress, interval }) {
  const matches = [], failed = [], processes = [];
  let done = 0;
  for (const { page, copy } of pages) {
    if (signal?.aborted) break;
    const label = `${copy.fileName} page ${page.pageIndex + 1}`;
    try {
      onProgress?.({ done, total: pages.length, stage: `sending ${label}` });
      const img = await loadImage(page);
      if (img.bytes.length > 20 * 1024 * 1024) throw new Error("the page image is larger than 20 MB");
      const { processId } = await client.submit({ bytes: img.bytes, htrId: settings.htrId, languageModel: settings.languageModel, lineModelId: settings.lineModelId || null });
      const st = await client.wait(processId, { signal, interval, onStatus: (s) => onProgress?.({ done, total: pages.length, stage: `${label}: ${s.toLowerCase()}` }) });
      processes.push({ pageId: page.id, processId, status: st.status });
      if (st.status !== "FINISHED") throw new Error(`the Transkribus job ended ${st.status.toLowerCase()}`);
      const xml = await client.pageXml(processId);
      const parsed = parsePageXml(xml);
      matches.push({ exportPage: { file: `process ${processId}`, xml, parsed }, page, copy, via: `api, model ${settings.htrId}`, aspect: { ok: true } });
    } catch (e) {
      if (e?.code === "aborted") break;
      failed.push({ file: label, error: String(e?.message ?? e) });
      if (e?.status === 401 || e?.status === 403 || e?.status === 429 || e?.code === "signed-out" || e?.code === "no-model") break;   // no point in sending more
    }
    done++;
  }
  if (!matches.length) return { runId: null, imported: 0, skipped: 0, failed, processes };
  const r = await importTranskribus({ library, matches, exportName: `Transkribus API (model ${settings.htrId})` });
  return { ...r, failed: [...failed, ...r.failed], processes };
}

export function describeRecognition(r) {
  const parts = [`Read ${r.imported} page${r.imported === 1 ? "" : "s"} with Transkribus`];
  if (r.skipped) parts.push(`${r.skipped} already had this text`);
  if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed[0].error}`);
  return `${parts.join("; ")}.`;
}
