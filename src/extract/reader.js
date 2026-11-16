import PROMPT from "./prompts/reading-v1.md?raw";
import { toBase64, LlmError } from "./clients/common.js";

// AI page reading (P6.T6): the chosen provider reads the page image and returns a diplomatic transcription and a
// proposed modern reading. The transcription becomes a new `transcription` text layer from processor
// `llm-reading` (the OCR layer stays); the modern reading is only a PROPOSAL on that layer (`proposedReading`),
// which the researcher applies with "Use AI reading" (a user action). Automated code: nothing here touches the
// researcher's reading (I6).

export const READING_PROMPT_VERSION = "reading-v1";
export const READING_PROMPT = PROMPT;
export const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["transcription", "modernReading"],
  properties: {
    transcription: { type: "string", description: "Diplomatic transcription: original spelling and line breaks, [?] for uncertain, […] for illegible." },
    modernReading: { type: "string", description: "The same text in modern Romanian spelling, keeping the [?] and […] marks." },
    notes: { type: "string" },
  },
};

export function validateReading(json) {
  const errors = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) errors.push("the answer must be an object");
  else {
    for (const k of ["transcription", "modernReading"]) if (typeof json[k] !== "string") errors.push(`${k} must be a string`);
    if (json.notes != null && typeof json.notes !== "string") errors.push("notes must be a string");
    for (const k of Object.keys(json)) if (!["transcription", "modernReading", "notes"].includes(k)) errors.push(`unexpected field '${k}'`);
    if (!errors.length && !json.transcription.trim()) errors.push("the transcription is empty");
  }
  return { ok: errors.length === 0, errors };
}

/** Has the page been read by an AI before? */
export async function wasReadByAi(library, wholeRegionId) {
  for (const l of await library.textLayers.listByRegion(wholeRegionId, "transcription")) {
    if ((await library.runs.getRun(l.runId))?.processor === "llm-reading") return true;
  }
  return false;
}

/**
 * @param {object} a  library, copy, client, loadImage, prepareImage, pageIds, force, maxPages, dryRun, onProgress, signal
 * (same meaning as extractCopy). Returns { runId, pages: [{ pageId, pageIndex, status, error?, chars? }], alreadyRead, overLimit, cancelled, dryRun }.
 */
export async function readPagesWithAi({ library, copy, client, loadImage, prepareImage = async (img) => img, pageIds, force = false, maxPages = 10, dryRun = false, onProgress, signal }) {
  let pages = await library.pages.listPages(copy.id);
  if (pageIds) pages = pages.filter((p) => pageIds.includes(p.id));
  const todo = [];
  let alreadyRead = 0;
  for (const page of pages) {
    const whole = await library.pages.wholePageRegion(page.id);
    if (!force && (await wasReadByAi(library, whole.id))) alreadyRead++; else todo.push({ page, whole });
  }
  const batch = todo.slice(0, maxPages);
  const summary = { copyId: copy.id, runId: null, dryRun, pages: [], alreadyRead, overLimit: todo.length - batch.length, cancelled: false };
  const hintOf = async (whole) => {
    const t = await library.textLayers.current(whole.id);
    return t?.originalText?.trim() ? `Earlier machine reading (OCR, may be wrong):\n<ocr>\n${t.originalText}\n</ocr>\n\n` : "";
  };

  if (dryRun) {
    for (const { page, whole } of batch) {
      const img = await loadImage(page);
      const prepared = img ? await prepareImage(img, { box: null }) : null;
      const chars = PROMPT.length + (await hintOf(whole)).length;
      summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, image: prepared ? { width: prepared.width, height: prepared.height, bytes: prepared.bytes.length } : null, estimatedInputTokens: Math.round(chars / 3.5) + (prepared ? 1600 : 0) });
    }
    return summary;
  }
  if (!client) throw new Error("No AI provider configured");

  const run = await library.runs.startRun({
    processor: "llm-reading", processorVersion: READING_PROMPT_VERSION, modelId: `${client.provider}:${client.model}`,
    parameters: { provider: client.provider, model: client.model, pageIds: batch.map((b) => b.page.id), force },
  });
  summary.runId = run.id;
  let ok = 0, failed = 0, done = 0;
  for (const { page, whole } of batch) {
    onProgress?.({ stage: "read", done, total: batch.length, pageIndex: page.pageIndex });
    if (signal?.aborted) { summary.cancelled = true; break; }
    done++;
    const item = await library.runs.addItem({ runId: run.id, pageId: page.id, status: "running" });
    try {
      const img = await loadImage(page);
      if (!img) throw new LlmError("This document has no page image to read (for example a DOCX)");
      const prepared = await prepareImage(img, { box: null });
      const answer = await client.complete({
        system: PROMPT, text: `${await hintOf(whole)}Transcribe this page as JSON matching the schema.`,
        image: { base64: toBase64(prepared.bytes), mediaType: prepared.mimeType }, schema: READING_SCHEMA, schemaName: "meridian_reading_v1", signal,
      });
      const raw = await library.runs.addRawOutput({ data: answer.rawText, mediaType: "application/json", schemaVersion: READING_PROMPT_VERSION });
      const v = validateReading(answer.json);
      if (!v.ok) {
        await library.runs.updateItem(item.id, { status: "failed", rawOutputId: raw.id, error: `The answer is not a usable reading: ${v.errors.join("; ")}` });
        failed++; summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, status: "failed", error: v.errors[0] });
        continue;
      }
      const layer = await library.textLayers.add({
        regionId: whole.id, runId: run.id, originalText: answer.json.transcription, language: "ro", script: "latin",
        proposedReading: answer.json.modernReading,
      });
      const result = { layerId: layer.id, chars: layer.originalText.length, notes: answer.json.notes ?? "", usage: answer.usage, model: answer.model };
      await library.runs.updateItem(item.id, { status: "succeeded", rawOutputId: raw.id, result });
      ok++; summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, status: "succeeded", ...result });
    } catch (e) {
      if (e?.name === "AbortError") { await library.runs.updateItem(item.id, { status: "skipped", error: "cancelled" }); summary.cancelled = true; break; }
      const error = e instanceof LlmError ? e.message : `Unexpected error: ${String(e?.message ?? e)}`;
      await library.runs.updateItem(item.id, { status: "failed", error: error.slice(0, 500) });
      failed++; summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, status: "failed", error });
      if (e instanceof LlmError && e.kind === "auth") break;
    }
  }
  await library.runs.finishRun(run.id, summary.cancelled ? "cancelled" : failed === 0 ? "succeeded" : ok === 0 ? "failed" : "partial");
  return summary;
}

export function describeReading(s) {
  const extra = [];
  if (s.alreadyRead) extra.push(`${s.alreadyRead} already read by AI (use Read with AI again)`);
  if (s.overLimit) extra.push(`${s.overLimit} over the page limit`);
  const tail = extra.length ? ` ${extra.join("; ")}.` : "";
  if (s.dryRun) {
    const tokens = s.pages.reduce((n, p) => n + p.estimatedInputTokens, 0);
    return s.pages.length ? `Dry run: would send ${s.pages.length} page image${s.pages.length === 1 ? "" : "s"} (about ${tokens.toLocaleString("en")} input tokens). Nothing was sent.${tail}` : `Dry run: nothing to send.${tail}`;
  }
  const ok = s.pages.filter((p) => p.status === "succeeded").length, bad = s.pages.filter((p) => p.status === "failed");
  return `AI read ${ok} page${ok === 1 ? "" : "s"}${bad.length ? `; ${bad.length} failed: ${bad[0].error}` : ""}${s.cancelled ? ". Stopped" : ""}. Open Review text to use its modern reading.${tail}`;
}
