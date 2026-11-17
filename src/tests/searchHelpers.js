import fs from "node:fs";
import path from "node:path";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary, toEvidence, writeRecords } from "../evidence/index.js";

export const DEATH = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", "death-1866.json"), "utf8"));

/** A small library: a parish register page (OCR text), the 1866 death page (records from the fixture), name variants. */
export async function searchLibrary({ storage = freshStorage() } = {}) {
  const library = createEvidenceLibrary(storage);
  const reg = await library.sources.create({ title: "Registrul de botezuri, Săhăteni", kind: "parish-register" });
  const civ = await library.sources.create({ title: "Registrul stării civile, Craiova, decese 1866", kind: "civil-register" });
  const c1 = (await library.copies.registerFile(new TextEncoder().encode("bot"), { sourceId: reg.id, storage: { mode: "blob", blobKey: "a" } })).copy;
  const c2 = (await library.copies.registerFile(new TextEncoder().encode("dec"), { sourceId: civ.id, storage: { mode: "blob", blobKey: "b" } })).copy;
  const p1 = await library.pages.addPage({ copyId: c1.id, pageIndex: 0, label: "f. 23v", width: 1000, height: 1400 });
  const p2 = await library.pages.addPage({ copyId: c2.id, pageIndex: 31, label: "32", width: 1000, height: 1400 });
  const ocr = await library.runs.startRun({ processor: "tesseract" });
  await library.textLayers.add({ regionId: p1.wholePageRegion.id, runId: ocr.id, originalText: "Ştefan fiul lui Iohannes Hariton, născut la Săhăteni 1850", confidence: 0.9 });
  await library.textLayers.add({ regionId: p2.wholePageRegion.id, runId: ocr.id, originalText: "REGISTRU STAREKI CIVILE noise", confidence: 0.34 });
  const llm = await library.runs.startRun({ processor: "llm-extraction" });
  const { written } = await writeRecords({ library, runId: llm.id, regionId: p2.wholePageRegion.id, records: toEvidence(DEATH), addAssertion: (i) => library.assertions.propose(i) });
  await library.nameVariants.add({ canonical: "Ioan", variant: "Iohannes" });
  await library.nameVariants.add({ canonical: "Ioan", variant: "Ion" });
  return { storage, library, sources: { reg, civ }, copies: { c1, c2 }, pages: { p1, p2 }, record: written[0], runs: { ocr, llm } };
}
