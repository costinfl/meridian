import { sha256Hex } from "../../evidence/index.js";
import { modelOf } from "./pageXml.js";

// Import matched Transkribus pages (P7b.T3). One `transkribus` run per import; per page a run item, the PAGE XML
// kept verbatim as raw output, and a new `transcription` text layer on the whole-page region: the page text, with
// every line kept as a positioned "word" (its box, 0-1). The newest transcription becomes the current one; OCR
// and AI transcriptions stay. Importing the same XML for the same page again is skipped. Automated code: it adds
// transcriptions only and never touches the researcher's reading (I6).

export const IMPORTER_VERSION = "page-xml-1";

/** Was this exact PAGE XML already imported for this page? */
async function alreadyImported(library, pageId, sha256) {
  for (const item of await library.runs.itemsForPage(pageId)) {
    if (item.status !== "succeeded" || item.result?.sha256 !== sha256) continue;
    if ((await library.runs.getRun(item.runId))?.processor === "transkribus") return true;
  }
  return false;
}

/**
 * @param {object} a
 * @param {object} a.library
 * @param {{ exportPage, page, copy, via, aspect }[]} a.matches   from matchPages (only those the user accepted)
 * @param {string} [a.exportName]   file name(s) of the export, recorded on the run
 * @returns {Promise<{ runId, imported, skipped, failed: { file, error }[] }>}
 */
export async function importTranskribus({ library, matches, exportName = "" }) {
  const models = [...new Set(matches.map((m) => modelOf(m.exportPage.parsed.metadata)).filter(Boolean))];
  const run = await library.runs.startRun({
    processor: "transkribus", processorVersion: IMPORTER_VERSION, modelId: (models[0] ?? "unknown").slice(0, 300),
    parameters: { exportName, pages: matches.length, models, created: matches[0]?.exportPage.parsed.metadata?.created ?? "" },
  });
  const out = { runId: run.id, imported: 0, skipped: 0, failed: [] };
  for (const m of matches) {
    const { exportPage: ep, page } = m;
    try {
      const sha256 = await sha256Hex(new TextEncoder().encode(ep.xml));
      if (await alreadyImported(library, page.id, sha256)) { out.skipped++; continue; }
      const whole = await library.pages.wholePageRegion(page.id);
      if (!whole) throw new Error("the page has no whole-page region");
      const raw = await library.runs.addRawOutput({ data: ep.xml, mediaType: "application/vnd.prima.page+xml", schemaVersion: "PAGE" });
      const words = ep.parsed.lines.filter((l) => l.box && l.text.trim()).map((l) => ({ text: l.text, box: l.box }));
      await library.textLayers.add({ regionId: whole.id, runId: run.id, originalText: ep.parsed.text, language: "ro", script: "latin", words });
      await library.runs.addItem({ runId: run.id, pageId: page.id, status: "succeeded", rawOutputId: raw.id,
        result: { sha256, file: ep.file, imageFilename: ep.parsed.imageFilename, lines: ep.parsed.lines.length, via: m.via, model: modelOf(ep.parsed.metadata) } });
      out.imported++;
    } catch (e) {
      out.failed.push({ file: ep.file, error: String(e?.message ?? e) });
      await library.runs.addItem({ runId: run.id, pageId: page.id, status: "failed", error: String(e?.message ?? e).slice(0, 500) }).catch(() => {});
    }
  }
  await library.runs.finishRun(run.id, out.failed.length ? (out.imported ? "partial" : "failed") : "succeeded");
  return out;
}

export function describeImport(r, unmatched = 0) {
  const parts = [`Imported ${r.imported} page${r.imported === 1 ? "" : "s"}`];
  if (r.skipped) parts.push(`${r.skipped} already imported`);
  if (unmatched) parts.push(`${unmatched} not matched`);
  if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed[0].error}`);
  return `${parts.join("; ")}.`;
}
