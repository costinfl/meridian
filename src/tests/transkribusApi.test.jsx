import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createTranskribusClient, recognizePages, describeRecognition, getTranskribusSettings, saveTranskribusSettings, transkribusMissing, toBase64, TOKEN_URL } from "../ingest/transkribus/index.js";
import TranskribusSettings from "../components/evidence/TranskribusSettings.jsx";

afterEach(() => cleanup());
const XML = fs.readFileSync(path.join(__dirname, "fixtures", "transkribus", "p32-2013.xml"), "utf8");

/** A stand-in for the Transkribus servers: records calls, answers like the API. */
function fakeTranskribus({ statuses = ["CREATED", "RUNNING", "FINISHED"], tokenStatus = 200, submitStatus = 200 } = {}) {
  const calls = [];
  let polls = 0, t = 1_000_000;
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(init.body);
      if (tokenStatus !== 200 || (form.get("grant_type") === "password" && form.get("password") !== "secret")) return json({ error: "invalid_grant" }, tokenStatus === 200 ? 401 : tokenStatus);
      return json({ access_token: `tok-${calls.length}`, refresh_token: "ref", expires_in: 300, refresh_expires_in: 1800, token_type: "Bearer" });
    }
    if (url.endsWith("/processes") && init.method === "POST") return submitStatus === 200 ? json({ processId: 4242, status: "CREATED" }) : json({ message: "nope" }, submitStatus);
    if (url.endsWith("/processes/4242/page")) return { ok: true, status: 200, text: async () => XML };
    if (url.endsWith("/processes/4242")) return json({ processId: 4242, status: statuses[Math.min(polls++, statuses.length - 1)] });
    return json({}, 404);
  };
  return { calls, fetchImpl, now: () => t, advance: (ms) => { t += ms; }, sleep: async () => {} };
}

describe("Transkribus API client (Phase 9 review, d)", () => {
  it("signs in with the password grant, sends the image as base64 with the model, polls, fetches PAGE XML", async () => {
    const f = fakeTranskribus();
    const c = createTranskribusClient({ fetchImpl: f.fetchImpl, now: f.now, sleep: f.sleep });
    await expect(c.submit({ bytes: new Uint8Array([1]), htrId: 1 })).rejects.toThrow(/Sign in/);
    await expect(c.signIn("ana@example.org", "wrong")).rejects.toThrow(/did not accept/);
    await c.signIn("ana@example.org", "secret");
    expect(c.signedIn).toEqual({ username: "ana@example.org" });
    const form = new URLSearchParams(f.calls[1].body);
    expect(Object.fromEntries(form)).toEqual({ client_id: "processing-api-client", grant_type: "password", username: "ana@example.org", password: "secret" });
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const sub = await c.submit({ bytes, htrId: "579509", languageModel: true });
    expect(sub).toEqual({ processId: 4242, status: "CREATED" });
    const post = f.calls.find((x) => x.method === "POST" && x.url.endsWith("/processes"));
    expect(post.url).toBe("https://transkribus.eu/processing/v1/processes");
    expect(post.headers.Authorization).toMatch(/^Bearer tok-/);
    expect(JSON.parse(post.body)).toEqual({ config: { textRecognition: { htrId: 579509, languageModel: "built-in" } }, image: { base64: toBase64(bytes) } });
    const seen = [];
    expect((await c.wait(4242, { onStatus: (s) => seen.push(s) })).status).toBe("FINISHED");
    expect(seen).toEqual(["CREATED", "RUNNING", "FINISHED"]);
    expect(await c.pageXml(4242)).toBe(XML);
    await expect(c.submit({ bytes, htrId: "" })).rejects.toThrow(/model id/);
  });

  it("refreshes an expired access token, and asks to sign in again when the session is over", async () => {
    const f = fakeTranskribus();
    const c = createTranskribusClient({ fetchImpl: f.fetchImpl, now: f.now, sleep: f.sleep });
    await c.signIn("ana", "secret");
    f.advance(400_000);                                               // access token expired, refresh still valid
    await c.status(4242);
    expect(f.calls.filter((x) => x.url === TOKEN_URL).map((x) => new URLSearchParams(x.body).get("grant_type"))).toEqual(["password", "refresh_token"]);
    f.advance(3_000_000);
    await expect(c.status(4242)).rejects.toThrow(/expired/);
    expect(c.signedIn).toBeNull();
  });

  it("explains refusals: no credits (429), account without the API (403)", async () => {
    for (const [status, re] of [[429, /no credits/], [403, /Scholar plan/]]) {
      const f = fakeTranskribus({ submitStatus: status });
      const c = createTranskribusClient({ fetchImpl: f.fetchImpl, now: f.now, sleep: f.sleep });
      await c.signIn("ana", "secret");
      await expect(c.submit({ bytes: new Uint8Array([1]), htrId: 1 })).rejects.toThrow(re);
    }
  });
});

describe("Read pages with Transkribus", () => {
  let library, storage, page, copy, whole;
  beforeEach(async () => {
    storage = freshStorage();
    library = createEvidenceLibrary(storage);
    copy = (await library.copies.registerFile(new TextEncoder().encode("png"), { fileName: "pag32-upright.png", storage: { mode: "blob", blobKey: "a" } })).copy;
    ({ page, wholePageRegion: whole } = await library.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 1475, height: 2320 }));
  });
  const loadImage = async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", width: 1475, height: 2320 });

  it("imports the result as a transkribus transcription with positioned lines; a failed job is reported", async () => {
    const f = fakeTranskribus();
    const client = createTranskribusClient({ fetchImpl: f.fetchImpl, now: f.now, sleep: f.sleep });
    const settings = { ...(await getTranskribusSettings(storage)), htrId: "579509" };
    expect(transkribusMissing(settings, client)).toMatch(/Sign in/);
    await client.signIn("ana", "secret");
    expect(transkribusMissing(settings, client)).toBe("");
    const r = await recognizePages({ library, client, settings, pages: [{ page, copy }], loadImage });
    expect(r).toMatchObject({ imported: 1, failed: [], processes: [{ pageId: page.id, processId: 4242, status: "FINISHED" }] });
    expect(describeRecognition(r)).toBe("Read 1 page with Transkribus.");
    const layer = await library.textLayers.current(whole.id);
    expect(layer.originalText).toMatch(/^Actu de încetare din viață/);
    expect(layer.words).toHaveLength(4);
    expect((await library.runs.getRun(r.runId))).toMatchObject({ processor: "transkribus", parameters: { exportName: "Transkribus API (model 579509)" } });
    expect(await library.textLayers.current(whole.id, "reading")).toBeNull();          // no reading made (I6)

    const bad = fakeTranskribus({ statuses: ["RUNNING", "FAILED"] });
    const c2 = createTranskribusClient({ fetchImpl: bad.fetchImpl, now: bad.now, sleep: bad.sleep });
    await c2.signIn("ana", "secret");
    const r2 = await recognizePages({ library, client: c2, settings, pages: [{ page, copy }], loadImage });
    expect(r2).toMatchObject({ imported: 0, runId: null });
    expect(r2.failed[0].error).toMatch(/ended failed/);
  });

  it("settings: kept on the device without the password; the panel signs in for the session", async () => {
    await saveTranskribusSettings(storage, { username: "ana", htrId: "579509", password: "secret" });
    expect(await getTranskribusSettings(storage)).toMatchObject({ username: "ana", htrId: "579509" });
    expect(JSON.stringify(await storage.getSetting("transkribus"))).not.toMatch(/secret/);
    const f = fakeTranskribus();
    const client = createTranskribusClient({ fetchImpl: f.fetchImpl, now: f.now, sleep: f.sleep });
    render(<TranskribusSettings storage={storage} client={client} />);
    const pw = await screen.findByLabelText("Transkribus password");
    fireEvent.change(pw, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("transkribus-status").textContent).toBe("Signed in as ana"));
    expect(JSON.stringify(await storage.getSetting("transkribus"))).not.toMatch(/secret/);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(client.signedIn).toBeNull();
  });
});
