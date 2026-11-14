import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkImports, importsOf, checkDbMethodUse, checkUserActionOnly } from "./archRules.js";

const SRC = path.resolve(__dirname, "..");

function readSources() {
  const files = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(SRC, full).split(path.sep).join("/");
      if (e.isDirectory()) { if (rel !== "tests") walk(full); }
      else if (/\.(js|jsx)$/.test(e.name)) files[rel] = fs.readFileSync(full, "utf8");
    }
  };
  walk(SRC);
  return files;
}

describe("architecture: import boundaries (I5)", () => {
  it("the current source tree respects every boundary", () => {
    expect(checkImports(readSources())).toEqual([]);
  });

  it("scans the evidence-layer folders (guards against an empty scan)", () => {
    const files = Object.keys(readSources());
    for (const f of ["evidence/index.js", "search/index.js", "graph/index.js", "conclusions/index.js", "App.jsx"]) {
      expect(files).toContain(f);
    }
  });

  it("evidence importing conclusions, models, UI or hooks is a violation", () => {
    const bad = {
      "evidence/a.js": 'import { x } from "../conclusions/families.js";',
      "evidence/b.js": 'import { createProject } from "../models/project.js";',
      "evidence/c.js": 'import React from "../components/Modal.jsx";',
      "evidence/d.js": 'export * from "../hooks/useProject.js";',
      "evidence/e.js": 'import "../App.jsx";',
    };
    expect(checkImports(bad)).toHaveLength(5);
  });

  it("search, graph and ingest may not import UI or conclusions; dynamic imports and worker URLs are scanned", () => {
    const bad = {
      "search/a.js": 'const m = await import("../components/evidence/Panel.jsx");',
      "graph/b.js": 'import { f } from "../conclusions/index.js";',
      "ingest/c.js": 'new Worker(new URL("../hooks/useProject.js", import.meta.url));',
    };
    expect(checkImports(bad)).toHaveLength(3);
  });

  it("allowed directions pass", () => {
    const ok = {
      "conclusions/a.js": 'import { r } from "../evidence/index.js"; import { createProject } from "../models/project.js";',
      "search/b.js": 'import { r } from "../evidence/repositories/x.js"; import "./local.js";',
      "workers/c.js": 'import { build } from "../search/index.js"; import { run } from "../ingest/index.js";',
      "components/evidence/P.jsx": 'import { r } from "../../evidence/index.js"; import { C } from "../../theme.js";',
      "evidence/d.js": 'import { storage } from "../storage/StorageService.js"; import JSZip from "jszip";',
    };
    expect(checkImports(ok)).toEqual([]);
  });

  it("importsOf finds static, side-effect, dynamic and worker-URL imports", () => {
    const src = 'import a from "./a.js"; import "./b.js"; export { c } from "./c.js"; import("./d.js"); new URL("./e.js", import.meta.url);';
    expect(importsOf(src).sort()).toEqual(["./a.js", "./b.js", "./c.js", "./d.js", "./e.js"]);
  });

  it("only storage and evidence repositories call generic db* store methods (I1)", () => {
    expect(checkDbMethodUse(readSources())).toEqual([]);
    expect(checkDbMethodUse({
      "evidence/repositories/a.js": "await storage.dbAdd('evSources', x);",
      "storage/adapters/IndexedDBAdapter.js": "this.dbPut(s, v)",
      "conclusions/b.js": "await storage.dbPut('evSources', x);",
      "components/evidence/P.jsx": "storage.dbTransact(['a'], 'readwrite', fn)",
    })).toHaveLength(2);
  });

  it("automated modules never take user decisions on assertions (I6)", () => {
    expect(checkUserActionOnly(readSources())).toEqual([]);
    expect(checkUserActionOnly({
      "ingest/extract.js": "await lib.assertions.confirmAssertion(id, { decidedBy: 'bot' });",
      "workers/er.js": "assertions.enterAsUser(x)",
      "search/a.js": "assertions.rejectAssertion(id)",
      "graph/ok.js": "assertions.propose(x)",
      "components/evidence/Review.jsx": "assertions.confirmAssertion(id, { decidedBy: 'user' })",
      "workers/links.js": "const r = decideLink(project, id, 'accepted', { decidedBy: 'bot' });",
      "ingest/legacy.js": "await convertLegacyFacts({ library, project })",
      "search/v.js": "confirmLegacyVerified({ library, project })",
      "graph/f.js": "await setFactVerified({ library, fact, verified: true })",
      "ingest/ok.js": "addLink(project, { personId, personaId })",
      "ingest/edit.js": "await applyFactEdit({ library, kind, personId, before, after })",
      "workers/sup.js": "library.assertions.supersedeAsUser(input)",
      "ingest/fix.js": "await library.textLayers.correctReading({ readingId, start, end, after })",
      "workers/r.js": "textLayers.startReading({ regionId })",
      "search/w.js": "textLayers.rewriteReading({ readingId, text })",
      "components/evidence/TextReview.jsx": "library.textLayers.correctReading(input)",
    })).toHaveLength(12);
  });
});
