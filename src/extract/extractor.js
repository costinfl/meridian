import { validateExtraction, toEvidence, writeRecords, EXTRACTION_SCHEMA, SCHEMA_VERSION, normalizeText } from "../evidence/index.js";
import PROMPT from "./prompts/extraction-v1.md?raw";
import { toBase64, LlmError } from "./clients/common.js";

// LLM extraction (P6.T3). For each page: send the page image (or a region of it) plus the page's current text
// (the researcher's modern reading if there is one, else the transcription) to the chosen provider, validate the
// answer against the extraction contract, and store records, personas and PROPOSED assertions. Automated code:
// nothing here confirms anything (I6; the architecture test enforces it).
//   - one `llm-extraction` run per batch (provider, model, prompt and schema versions on the run, I3);
//   - one run item per page; the raw answer is kept; an invalid answer fails only its page;
//   - a page already extracted is skipped unless `force`;
//   - a claim the researcher rejected before (same page, property and normalised value) is not proposed again;
//   - `dryRun` makes no call and writes nothing: it reports what would be sent.

export const PROMPT_VERSION = "extraction-v1";
export const EXTRACTION_PROMPT = PROMPT;
const IMAGE_TOKENS = 1600;             // a ~1568 px image is about this many input tokens
const CHARS_PER_TOKEN = 3.5;

const keyOf = (property, normalizedValue, originalValue) =>
  `${property}|${normalizedValue !== undefined && normalizedValue !== null && typeof normalizedValue === "object" ? JSON.stringify(normalizedValue) : normalizeText(String(normalizedValue ?? originalValue ?? "")).toLowerCase()}`;

/** Text sent with the image: the modern reading if any, else the current transcription, else "". */
export async function pageTextOf(library, wholeRegionId) {
  const reading = await library.textLayers.current(wholeRegionId, "reading");
  if (reading?.originalText) return { text: reading.originalText, from: "reading" };
  const t = await library.textLayers.current(wholeRegionId);
  return { text: t?.originalText ?? "", from: t ? "transcription" : "none" };
}

/** Has an earlier extraction run produced records on this page? */
export async function wasExtracted(library, pageId) {
  for (const region of await library.pages.listRegions(pageId)) {
    for (const record of await library.records.recordsByRegion(region.id)) {
      if ((await library.runs.getRun(record.runId))?.processor === "llm-extraction") return true;
    }
  }
  return false;
}

/** Keys of claims rejected on any region of the page. */
async function rejectedKeys(library, pageId) {
  const keys = new Set();
  for (const region of await library.pages.listRegions(pageId)) {
    for (const a of await library.assertions.listByRegion(region.id)) if (a.status === "rejected") keys.add(keyOf(a.property, a.normalizedValue, a.originalValue));
  }
  return keys;
}

export function userTextOf({ text, from, region }) {
  const parts = [];
  if (region) parts.push("The image is ONE REGION of the page, cropped by the researcher. Read only what is inside it; boxes are fractions of this cropped image.");
  if (text.trim()) parts.push(`Text reading of the whole page (${from === "reading" ? "the researcher's modern reading" : "machine transcription, may contain errors"}):\n<page_text>\n${text}\n</page_text>`);
  else parts.push("There is no text reading of this page; read the image.");
  parts.push("List the records on the image as JSON matching the schema.");
  return parts.join("\n\n");
}

/**
 * @param {object} a
 * @param {object} a.library
 * @param {object} a.copy
 * @param {object} [a.client]          clientFor(settings): { provider, model, complete() } (not needed for a dry run)
 * @param {(page) => Promise<{bytes, mimeType, width, height}|null>} a.loadImage
 * @param {(img, { box }) => Promise<{bytes, mimeType, width, height}>} [a.prepareImage]  crop + downscale (browser); identity if absent
 * @param {string[]} [a.pageIds]       only these pages
 * @param {string} [a.regionId]        read only this region (one page)
 * @param {boolean} [a.force]          extract pages that were extracted before
 * @param {number} [a.maxPages=10]     page limit per batch
 * @param {boolean} [a.dryRun]
 */
export async function extractCopy({ library, copy, client, loadImage, prepareImage = async (img) => img, pageIds, regionId = null, force = false, maxPages = 10, dryRun = false, onProgress, signal }) {
  let pages = await library.pages.listPages(copy.id);
  if (pageIds) pages = pages.filter((p) => pageIds.includes(p.id));
  const region = regionId ? await library.pages.getRegion(regionId) : null;
  if (regionId && !region) throw new Error(`Region not found: ${regionId}`);
  if (region) pages = pages.filter((p) => p.id === region.pageId);

  const todo = [], skippedDone = [];
  for (const page of pages) {
    if (!force && !region && (await wasExtracted(library, page.id))) skippedDone.push(page); else todo.push(page);
  }
  const batch = todo.slice(0, maxPages);
  const summary = { copyId: copy.id, runId: null, dryRun, pages: [], alreadyExtracted: skippedDone.length, overLimit: todo.length - batch.length, cancelled: false };

  if (dryRun) {
    for (const page of batch) {
      const whole = await library.pages.wholePageRegion(page.id);
      const { text, from } = await pageTextOf(library, whole.id);
      const img = await loadImage(page);
      const prepared = img ? await prepareImage(img, { box: region && region.kind !== "page" ? region.box : null }) : null;
      const promptChars = PROMPT.length + JSON.stringify(EXTRACTION_SCHEMA).length + userTextOf({ text, from, region: !!region }).length;
      summary.pages.push({
        pageId: page.id, pageIndex: page.pageIndex, textFrom: from, textChars: text.length,
        image: prepared ? { width: prepared.width, height: prepared.height, bytes: prepared.bytes.length } : null,
        estimatedInputTokens: Math.round(promptChars / CHARS_PER_TOKEN) + (prepared ? IMAGE_TOKENS : 0),
      });
    }
    return summary;
  }
  if (!client) throw new Error("No AI provider configured");

  const run = await library.runs.startRun({
    processor: "llm-extraction", processorVersion: PROMPT_VERSION, modelId: `${client.provider}:${client.model}`, schemaVersion: SCHEMA_VERSION,
    parameters: { provider: client.provider, model: client.model, pageIds: batch.map((p) => p.id), regionId, force, input: "image+text" },
  });
  summary.runId = run.id;
  let ok = 0, failed = 0, done = 0;
  for (const page of batch) {
    onProgress?.({ stage: "extract", done, total: batch.length, pageIndex: page.pageIndex });
    if (signal?.aborted) { summary.cancelled = true; break; }
    done++;
    const item = await library.runs.addItem({ runId: run.id, pageId: page.id, status: "running" });
    try {
      const whole = await library.pages.wholePageRegion(page.id);
      const target = region ?? whole;
      const { text, from } = await pageTextOf(library, whole.id);
      const img = await loadImage(page);
      const prepared = img ? await prepareImage(img, { box: target.kind !== "page" ? target.box : null }) : null;
      const answer = await client.complete({
        system: PROMPT, text: userTextOf({ text, from, region: target.kind !== "page" }),
        image: prepared ? { base64: toBase64(prepared.bytes), mediaType: prepared.mimeType } : null,
        schema: EXTRACTION_SCHEMA, schemaName: "meridian_extraction_v1", signal,
      });
      const raw = await library.runs.addRawOutput({ data: answer.rawText, mediaType: "application/json", schemaVersion: SCHEMA_VERSION });
      const v = validateExtraction(answer.json);
      if (!v.ok) {
        await library.runs.updateItem(item.id, { status: "failed", rawOutputId: raw.id, error: `The answer does not match the extraction contract: ${v.errors.slice(0, 5).join("; ")}` });
        failed++; summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, status: "failed", error: v.errors[0] });
        continue;
      }
      const rejected = await rejectedKeys(library, page.id);
      const { written, skipped } = await writeRecords({
        library, runId: run.id, regionId: target.id, records: toEvidence(answer.json),
        addAssertion: (input) => library.assertions.propose(input),
        skip: async ({ property, normalizedValue, originalValue }) => rejected.has(keyOf(property, normalizedValue, originalValue)),
      });
      const result = { records: written.length, assertions: written.reduce((n, w) => n + w.assertions.length, 0), skippedRejected: skipped, textFrom: from, usage: answer.usage, model: answer.model, notes: answer.json.notes ?? "" };
      await library.runs.updateItem(item.id, { status: "succeeded", rawOutputId: raw.id, result });
      ok++; summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, status: "succeeded", ...result });
    } catch (e) {
      if (e?.name === "AbortError") { await library.runs.updateItem(item.id, { status: "skipped", error: "cancelled" }); summary.cancelled = true; break; }
      const error = e instanceof LlmError ? e.message : `Unexpected error: ${String(e?.message ?? e)}`;
      await library.runs.updateItem(item.id, { status: "failed", error: error.slice(0, 500) });
      failed++; summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, status: "failed", error });
      if (e instanceof LlmError && e.kind === "auth") break;    // every other page would fail the same way
    }
  }
  await library.runs.finishRun(run.id, summary.cancelled ? "cancelled" : failed === 0 ? "succeeded" : ok === 0 ? "failed" : "partial");
  onProgress?.({ stage: "done", done, total: batch.length, pageIndex: null });
  return summary;
}
