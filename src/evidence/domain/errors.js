export class EvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EvidenceError";
    this.code = code; // e.g. "invalid", "not-found", "conflict", "invariant"
  }
}

export const invalid = (msg) => new EvidenceError("invalid", msg);
export const notFound = (what, id) => new EvidenceError("not-found", `${what} not found: ${id}`);

export function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${field} is required`);
  return value.trim();
}

export function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw invalid(`${field} must be one of: ${allowed.join(", ")}`);
  return value;
}

/** Copy only whitelisted keys that are present in `patch`. */
export function pick(patch, keys) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(patch ?? {}, k)) out[k] = patch[k];
  return out;
}
