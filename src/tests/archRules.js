// Import-boundary rules for the evidence layer (invariant I5 and friends).
// A "group" is the first path segment under src/ (components/** and App/hooks/main = "ui").
import path from "node:path";

export const UI_GROUPS = new Set(["ui"]);

// group -> groups it may import (itself is always allowed)
export const ALLOWED = {
  evidence: ["storage"],
  conclusions: ["evidence", "models", "storage"],
  ingest: ["evidence", "storage"],
  search: ["evidence"],
  graph: ["evidence"],
  storage: [],
  workers: ["evidence", "conclusions", "ingest", "search", "graph", "models", "storage"],
  // models, ui, and top-level modules (share.js, gedcom.js, theme.js, sampleData.js) are unrestricted
};

export function groupOf(relToSrc) {
  const parts = relToSrc.split("/");
  const first = parts[0];
  if (parts.length === 1) {
    return ["App.jsx", "main.jsx"].includes(first) ? "ui" : "top"; // share.js, gedcom.js, theme.js, ...
  }
  if (first === "components" || first === "hooks") return "ui";
  return first;
}

const IMPORT_RES = [
  /\bfrom\s*["']([^"']+)["']/g,          // import x from "..." / export ... from "..."
  /\bimport\s*["']([^"']+)["']/g,        // import "..."
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("...")
  /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g, // new Worker(new URL("...", import.meta.url))
];

export function importsOf(source) {
  const out = [];
  for (const re of IMPORT_RES) for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

/** files: { "evidence/foo.js": "source text", ... } with paths relative to src/. Returns violation strings. */
export function checkImports(files) {
  const violations = [];
  for (const [file, source] of Object.entries(files)) {
    const from = groupOf(file);
    const rule = ALLOWED[from];
    if (!rule) continue;
    for (const spec of importsOf(source)) {
      if (!spec.startsWith(".")) continue; // packages are not layered
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (target.startsWith("..")) { violations.push(`${file} imports outside src: ${spec}`); continue; }
      const to = groupOf(target);
      if (to === from || rule.includes(to)) continue;
      violations.push(`${file} (${from}) must not import ${target} (${to})`);
    }
  }
  return violations;
}

// Generic store methods may only be called by the storage layer and evidence repositories (I1).
const DB_CALL = /\.db(Transact|Get|Put|Add|GetAll|GetAllByIndex|GetByIndex|Count)\s*\(/;
export function checkDbMethodUse(files) {
  const violations = [];
  for (const [file, source] of Object.entries(files)) {
    if (file.startsWith("storage/") || file.startsWith("evidence/repositories/")) continue;
    if (DB_CALL.test(source)) violations.push(`${file} calls a generic db* store method; only src/storage and src/evidence/repositories may`);
  }
  return violations;
}

// I6: automated modules must never confirm/reject assertions or enter claims as the user.
const USER_ACTION = /\.(confirmAssertion|rejectAssertion|enterAsUser)\s*\(/;
const AUTOMATED = ["ingest/", "search/", "graph/", "workers/"];
export function checkUserActionOnly(files) {
  const violations = [];
  for (const [file, source] of Object.entries(files)) {
    if (AUTOMATED.some((d) => file.startsWith(d)) && USER_ACTION.test(source)) {
      violations.push(`${file} calls a user-action method (confirmAssertion/rejectAssertion/enterAsUser); automated code may only propose`);
    }
  }
  return violations;
}
