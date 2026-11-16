// Shared by the provider clients. A client is { provider, model, complete(request) } where
//   request  = { system, text, image?: { base64, mediaType }, schema, schemaName, maxTokens?, signal? }
//   result   = { json, rawText, stopReason, usage: { inputTokens, outputTokens }, model }
// and every failure is an LlmError with a message a person can act on.

export class LlmError extends Error {
  constructor(message, { kind = "error", retryable = false, status = null } = {}) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;          // auth | rate-limit | refusal | cut-off | bad-output | network | error
    this.retryable = retryable;
    this.status = status;
  }
}

/** The contract schema as sent to a provider: `$defs` instead of `definitions`, no `$schema`/`$id`. */
export function apiSchemaOf(schema) {
  const json = JSON.stringify(schema).replaceAll("#/definitions/", "#/$defs/");
  const { $schema, $id, definitions, ...rest } = JSON.parse(json);
  return definitions ? { ...rest, $defs: definitions } : rest;
}

export function parseJsonText(text) {
  const t = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch (e) { throw new LlmError(`the answer was not valid JSON (${e.message})`, { kind: "bad-output" }); }
}

/** Base64 of bytes, in chunks (works in browsers and Node). */
export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
