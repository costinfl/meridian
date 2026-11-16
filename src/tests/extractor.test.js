import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freshStorage } from "./evidenceHelpers.js";
import { memoryDeviceStorage } from "./ingestHelpers.js";
import { createEvidenceLibrary, EXTRACTION_SCHEMA } from "../evidence/index.js";
import { extractCopy, getAiSettings, saveAiSettings, missingSetup, maskKey, clientFor, apiSchemaOf, LlmError } from "../extract/index.js";
import { createAnthropicClient } from "../extract/clients/anthropic.js";
import { createOpenAiClient } from "../extract/clients/openai.js";

const DEATH = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", "death-1866.json"), "utf8"));
const IMG = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), mimeType: "image/png", width: 1475, height: 2320 };

let library, copy, pages;
async function setup(n = 1) {
  library = createEvidenceLibrary(freshStorage());
  copy = (await library.copies.registerFile(new TextEncoder().encode(`reg${n}`), { storage: { mode: "blob", blobKey: "k" } })).copy;
  pages = [];
  for (let i = 0; i < n; i++) pages.push((await library.pages.addPage({ copyId: copy.id, pageIndex: i, width: 1475, height: 2320 })).page);
  const ocr = await library.runs.startRun({ processor: "tesseract" });
  for (const p of pages) await library.textLayers.add({ regionId: (await library.pages.wholePageRegion(p.id)).id, runId: ocr.id, originalText: "REGISTRU STAREKI CIVILE. noise" });
}
function stubClient(answers) {
  const calls = [];
  return {
    provider: "anthropic", model: "claude-opus-5-5", calls,
    async complete(req) {
      calls.push(req);
      const a = typeof answers === "function" ? answers(calls.length) : answers;
      if (a instanceof Error) throw a;
      return { json: a, rawText: JSON.stringify(a), stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 2100, outputTokens: 900 } };
    },
  };
}
const loadImage = async () => IMG;

describe("AI settings (device only)", () => {
  it("defaults, saves, validates, and reports what is missing", async () => {
    const storage = memoryDeviceStorage(freshStorage());
    const s0 = await getAiSettings(storage);
    expect(s0).toEqual({ provider: "anthropic", models: { anthropic: "claude-opus-5-5", openai: "" }, keys: { anthropic: "", openai: "" }, maxPages: 10 });
    expect(missingSetup(s0)).toMatch(/Add your Anthropic Claude API key/);
    const s1 = await saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-abcdefghijkl" } });
    expect(missingSetup(s1)).toBe("");
    expect(missingSetup(await saveAiSettings(storage, { provider: "openai", keys: { openai: "sk-proj-1" } }))).toMatch(/Choose a OpenAI model/);
    await expect(saveAiSettings(storage, { maxPages: 0 })).rejects.toThrow(/page limit/);
    expect(maskKey("sk-ant-api03-abcdefghijkl")).toBe("sk-ant…ijkl");
    expect([...storage.settings.keys()]).toEqual(["aiSettings"]);
  });
});

describe("extractCopy (P6.T3)", () => {
  beforeEach(() => setup(1));

  it("sends image + text, stores a run, raw output, records and PROPOSED assertions citing a child region", async () => {
    const client = stubClient(DEATH);
    const s = await extractCopy({ library, copy, client, loadImage });
    expect(s.pages).toEqual([expect.objectContaining({ status: "succeeded", records: 1, skippedRejected: 0, textFrom: "transcription" })]);
    const req = client.calls[0];
    expect(req.image).toEqual({ base64: Buffer.from(IMG.bytes).toString("base64"), mediaType: "image/png" });
    expect(req.text).toMatch(/machine transcription, may contain errors[\s\S]*REGISTRU STAREKI/);
    expect(req.system).toMatch(/Copy names, places, occupations, ages and dates exactly as written/);
    expect(req.schema).toBe(EXTRACTION_SCHEMA);
    const run = await library.runs.getRun(s.runId);
    expect(run).toMatchObject({ processor: "llm-extraction", processorVersion: "extraction-v1", modelId: "anthropic:claude-opus-5-5", schemaVersion: "1", status: "succeeded" });
    const [item] = await library.runs.listItems(run.id);
    expect(item).toMatchObject({ status: "succeeded", result: { records: 1, usage: { inputTokens: 2100, outputTokens: 900 }, notes: DEATH.notes } });
    expect(new TextDecoder().decode((await library.runs.getRawOutput(item.rawOutputId)).bytes)).toBe(JSON.stringify(DEATH));
    const proposed = await library.assertions.listByStatus("proposed");
    expect(proposed.length).toBeGreaterThan(10);
    expect(await library.assertions.listByStatus("confirmed")).toEqual([]);        // I6
    const cited = await library.pages.getRegion(proposed[0].citation.regionId);
    expect(cited).toMatchObject({ kind: "block", box: DEATH.records[0].box });
  });

  it("uses the modern reading as text when there is one", async () => {
    const whole = await library.pages.wholePageRegion(pages[0].id);
    const r = await library.textLayers.startReading({ regionId: whole.id });
    await library.textLayers.rewriteReading({ readingId: r.id, text: "Anulu una mie optu sute șaizeci și șase … D-ei Șfatu Loti" });
    const client = stubClient(DEATH);
    await extractCopy({ library, copy, client, loadImage });
    expect(client.calls[0].text).toMatch(/the researcher's modern reading[\s\S]*Șfatu Loti/);
  });

  it("an answer that breaks the contract fails its page with the validation error; the run is 'failed'", async () => {
    const bad = JSON.parse(JSON.stringify(DEATH)); bad.records[0].relations[0].object = "nobody";
    const s = await extractCopy({ library, copy, client: stubClient(bad), loadImage });
    expect(s.pages[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/unknown object 'nobody'/) });
    const [item] = await library.runs.listItems(s.runId);
    expect(item.error).toMatch(/does not match the extraction contract/);
    expect(item.rawOutputId).toBeTruthy();                                          // the bad answer is kept for inspection
    expect((await library.runs.getRun(s.runId)).status).toBe("failed");
    expect(await library.records.recordsByKind("death")).toEqual([]);
  });

  it("skips pages already extracted unless forced, and does not re-propose a rejected claim", async () => {
    await extractCopy({ library, copy, client: stubClient(DEATH), loadImage });
    const again = await extractCopy({ library, copy, client: stubClient(DEATH), loadImage });
    expect(again).toMatchObject({ alreadyExtracted: 1, pages: [] });
    const name = (await library.assertions.listByStatus("proposed")).find((a) => a.property === "name" && a.originalValue === "Șfatu Loti");
    await library.assertions.rejectAssertion(name.id, { decidedBy: "researcher" });
    const forced = await extractCopy({ library, copy, client: stubClient(DEATH), loadImage, force: true });
    expect(forced.pages[0]).toMatchObject({ status: "succeeded", skippedRejected: 1 });
    const names = (await library.assertions.listByStatus("proposed")).filter((a) => a.property === "name" && a.originalValue === "Șfatu Loti");
    expect(names).toEqual([]);
  });

  it("respects the page limit, stops on an auth error, and reports cancel", async () => {
    await setup(4);
    const limited = await extractCopy({ library, copy, client: stubClient({ schemaVersion: "1", records: [] }), loadImage, maxPages: 2 });
    expect(limited).toMatchObject({ overLimit: 2 });
    expect(limited.pages).toHaveLength(2);

    await setup(3);
    const auth = stubClient(() => new LlmError("Anthropic refused the API key", { kind: "auth" }));
    const s = await extractCopy({ library, copy, client: auth, loadImage });
    expect(auth.calls).toHaveLength(1);
    expect(s.pages).toEqual([expect.objectContaining({ status: "failed", error: "Anthropic refused the API key" })]);

    await setup(3);
    const ctl = new AbortController();
    const c = await extractCopy({ library, copy, client: stubClient({ schemaVersion: "1", records: [] }), loadImage, signal: ctl.signal, onProgress: (p) => { if (p.done === 1) ctl.abort(); } });
    expect(c.cancelled).toBe(true);
    expect((await library.runs.getRun(c.runId)).status).toBe("cancelled");
  });

  it("a region extraction crops the image to the region and cites inside it", async () => {
    const whole = await library.pages.wholePageRegion(pages[0].id);
    const region = await library.pages.addRegion({ pageId: pages[0].id, parentRegionId: whole.id, box: { x0: 0, y0: 0.5, x1: 1, y1: 1 }, kind: "block" });
    const prepareImage = vi.fn(async (img, { box }) => ({ ...img, width: 100, height: 50, box }));
    const client = stubClient(DEATH);
    await extractCopy({ library, copy, client, loadImage, prepareImage, regionId: region.id });
    expect(prepareImage).toHaveBeenCalledWith(IMG, { box: region.box });
    expect(client.calls[0].text).toMatch(/ONE REGION of the page/);
    const cited = await library.pages.getRegion((await library.assertions.listByStatus("proposed"))[0].citation.regionId);
    expect(cited.parentRegionId).toBe(region.id);
    expect(cited.box).toEqual({ x0: 0.05, y0: 0.54, x1: 0.97, y1: 0.86 });
  });

  it("with requireRegion (the app's setting) a whole-page call is refused; a margin-note box adds the annotation hint", async () => {
    const client = stubClient(DEATH);
    await expect(extractCopy({ library, copy, client, loadImage, requireRegion: true })).rejects.toThrow(/Draw a box/);
    const whole = await library.pages.wholePageRegion(pages[0].id);
    await expect(extractCopy({ library, copy, client, loadImage, requireRegion: true, regionId: whole.id })).rejects.toThrow(/Draw a box/);
    const stamp = await library.pages.addRegion({ pageId: pages[0].id, parentRegionId: whole.id, box: { x0: 0.7, y0: 0, x1: 1, y1: 0.3 }, kind: "other", label: "Margin note / stamp 1" });
    await extractCopy({ library, copy, client, loadImage, requireRegion: true, regionId: stamp.id });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].text).toMatch(/STAMP or MARGIN NOTE/);
    expect(await library.runs.listRuns()).toHaveLength(2);                          // OCR + one extraction; the refused calls wrote nothing
  });

  it("a dry run calls nothing and writes nothing", async () => {
    const client = stubClient(DEATH);
    const s = await extractCopy({ library, copy, client, loadImage, dryRun: true });
    expect(client.calls).toEqual([]);
    expect(await library.runs.listRuns()).toHaveLength(1);                        // only the OCR run from setup
    expect(s.pages[0]).toMatchObject({ textFrom: "transcription", image: { width: 1475, height: 2320, bytes: 7 } });
    expect(s.pages[0].estimatedInputTokens).toBeGreaterThan(1600);
  });
});

describe("provider clients (no real API calls)", () => {
  const schemaReq = { system: "sys", text: "read this", image: { base64: "AAAA", mediaType: "image/jpeg" }, schema: EXTRACTION_SCHEMA };
  const reply = (status, body) => ({ ok: status < 400, status, statusText: "", headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body) });

  it("the contract is sent with $defs and without $schema/$id", () => {
    const s = apiSchemaOf(EXTRACTION_SCHEMA);
    expect(s.$schema).toBeUndefined();
    expect(Object.keys(s.$defs)).toEqual(Object.keys(EXTRACTION_SCHEMA.definitions));
    expect(JSON.stringify(s)).not.toMatch(/#\/definitions\//);
  });

  it("Anthropic: the real SDK sends image + text, structured output, effort and fallbacks; refusals and auth errors are explained", async () => {
    const requests = [];
    const answer = { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(DEATH) }], usage: { input_tokens: 2000, output_tokens: 800 } };
    let next = () => new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    const fetch = async (url, init) => { requests.push({ url: String(url), init }); return next(); };
    const client = createAnthropicClient({ apiKey: "sk-ant-test", model: "claude-opus-5-5", fetch });
    const r = await client.complete(schemaReq);
    expect(r.json).toEqual(DEATH);
    expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 800 });
    const req = requests[0];
    expect(req.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    const headers = req.init.headers;          // the SDK passes a Headers instance
    expect(headers.get("authorization")).toBe("Bearer sk-ant-test");         // SDK 1.x sends the key as a bearer token
    expect(headers.get("anthropic-beta")).toMatch(/server-side-fallback-2026-07-01/);
    const body = JSON.parse(req.init.body);
    expect(body).toMatchObject({ model: "claude-opus-5-5", system: "sys", fallbacks: "default", output_config: { effort: "high", format: { type: "json_schema" } } });
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: "read this" });
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(/"maxLength"|"minimum"/);   // unsupported constraints moved out by the SDK

    next = () => new Response(JSON.stringify({ ...answer, stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [] }), { status: 200, headers: { "content-type": "application/json" } });
    await expect(client.complete(schemaReq)).rejects.toMatchObject({ name: "LlmError", kind: "refusal" });
    next = () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
    await expect(client.complete(schemaReq)).rejects.toMatchObject({ kind: "auth", message: expect.stringMatching(/refused the API key/) });

    // Haiku has no server-side fallback: none is requested
    const haiku = createAnthropicClient({ apiKey: "k", model: "claude-haiku-5-5", fetch });
    next = () => new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    await haiku.complete(schemaReq);
    expect(JSON.parse(requests.at(-1).init.body).fallbacks).toBeUndefined();
  });

  it("OpenAI: sends a data-URL image and a JSON schema; maps errors", async () => {
    const calls = [];
    let next = reply(200, { model: "m", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(DEATH) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const fetch = async (url, init) => { calls.push({ url, init }); return next; };
    const client = createOpenAiClient({ apiKey: "sk-test", model: "m", fetch });
    expect((await client.complete(schemaReq)).json).toEqual(DEATH);
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers.authorization).toBe("Bearer sk-test");
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "result", strict: false } });
    next = reply(429, { error: { message: "slow down" } });
    await expect(client.complete(schemaReq)).rejects.toMatchObject({ kind: "rate-limit", retryable: true });
    next = reply(200, { choices: [{ finish_reason: "length", message: { content: "{" } }] });
    await expect(client.complete(schemaReq)).rejects.toMatchObject({ kind: "cut-off" });
    next = reply(200, { choices: [{ finish_reason: "stop", message: { content: "not json" } }] });
    await expect(client.complete(schemaReq)).rejects.toMatchObject({ kind: "bad-output" });
    expect(() => createOpenAiClient({ apiKey: "k", model: "" })).toThrow(/No OpenAI model/);
  });

  it("clientFor picks the provider from settings", () => {
    const c = clientFor({ provider: "openai", keys: { openai: "k" }, models: { openai: "m" } }, { fetch: async () => {} });
    expect([c.provider, c.model]).toEqual(["openai", "m"]);
  });
});
