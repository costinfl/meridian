import { LlmError, apiSchemaOf, parseJsonText } from "./common.js";

// OpenAI Chat Completions with JSON-schema output, called from the browser with the user's own key (kept on the
// device, I9). The schema is sent non-strict (strict mode would require every field); the answer is validated
// locally against the full contract.

const URL = "https://api.openai.com/v1/chat/completions";

export function createOpenAiClient({ apiKey, model, fetch = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!apiKey) throw new LlmError("No OpenAI API key", { kind: "auth" });
  if (!model) throw new LlmError("No OpenAI model chosen (set it in AI settings)", { kind: "error" });
  return {
    provider: "openai",
    model,
    async complete({ system, text, image, schema, schemaName = "result", maxTokens = 16000, signal }) {
      const user = [{ type: "text", text }];
      if (image) user.push({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
      let res;
      try {
        res = await fetch(URL, {
          method: "POST", signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model, max_completion_tokens: maxTokens,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            response_format: { type: "json_schema", json_schema: { name: schemaName, schema: apiSchemaOf(schema), strict: false } },
          }),
        });
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        throw new LlmError("Could not reach OpenAI (offline?)", { kind: "network", retryable: true });
      }
      let body = null;
      try { body = await res.json(); } catch { /* not JSON */ }
      if (!res.ok) {
        const msg = body?.error?.message ?? res.statusText ?? "";
        if (res.status === 401 || res.status === 403) throw new LlmError("OpenAI refused the API key (check it in AI settings)", { kind: "auth", status: res.status });
        if (res.status === 429) throw new LlmError("OpenAI rate limit reached; try again in a minute", { kind: "rate-limit", retryable: true, status: res.status });
        throw new LlmError(`OpenAI error ${res.status}: ${msg}`.trim(), { kind: "error", retryable: res.status >= 500, status: res.status });
      }
      const choice = body?.choices?.[0];
      if (choice?.message?.refusal) throw new LlmError(`The model declined this page: ${choice.message.refusal}`, { kind: "refusal" });
      if (choice?.finish_reason === "length") throw new LlmError("The answer was cut off (too long for one page); try a smaller region", { kind: "cut-off" });
      const rawText = choice?.message?.content ?? "";
      return {
        json: parseJsonText(rawText), rawText, stopReason: choice?.finish_reason ?? null, model: body?.model ?? model,
        usage: { inputTokens: body?.usage?.prompt_tokens ?? null, outputTokens: body?.usage?.completion_tokens ?? null },
      };
    },
  };
}
