import { LlmError, apiSchemaOf, parseJsonText } from "./common.js";

// Anthropic Claude through the official SDK (@anthropic-ai/sdk), called from the browser with the user's own key.
// The SDK refuses to run in a browser unless told it may (`dangerouslyAllowBrowser`): Meridian has no server, the
// key belongs to the person using it, stays on their device (settings store, I9) and is sent only to Anthropic.
// The answer is constrained to the contract with structured outputs (output_config.format) and validated again
// locally. Refusal fallbacks are on for the models that support them ("default" routing).

const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5|mythos-5)/;

export function createAnthropicClient({ apiKey, model, loadSdk = () => import("@anthropic-ai/sdk"), loadHelper = () => import("@anthropic-ai/sdk/helpers/json-schema"), fetch } = {}) {
  if (!apiKey) throw new LlmError("No Anthropic API key", { kind: "auth" });
  let client = null;
  const sdkClient = async () => {
    if (client) return client;
    const { default: Anthropic } = await loadSdk();
    client = { Anthropic, api: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(fetch ? { fetch } : {}) }) };
    return client;
  };

  return {
    provider: "anthropic",
    model,
    async complete({ system, text, image, schema, maxTokens = 16000, signal }) {
      const { Anthropic, api } = await sdkClient();
      const { jsonSchemaOutputFormat } = await loadHelper();
      const format = jsonSchemaOutputFormat(apiSchemaOf(schema));   // the SDK moves unsupported constraints out of the schema
      const content = [];
      if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
      content.push({ type: "text", text });
      const body = {
        model, max_tokens: maxTokens, system,
        messages: [{ role: "user", content }],
        output_config: { effort: "high", format: { type: "json_schema", schema: format.schema } },
      };
      if (FALLBACK_MODELS.test(model)) Object.assign(body, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
      let res;
      try {
        res = await api.beta.messages.create(body, { signal });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new LlmError("Anthropic refused the API key (check it in AI settings)", { kind: "auth", status: e.status });
        if (e instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic rate limit reached; try again in a minute", { kind: "rate-limit", retryable: true, status: e.status });
        if (e instanceof Anthropic.BadRequestError) throw new LlmError(`Anthropic rejected the request: ${e.message}`, { kind: "error", status: e.status });
        if (e instanceof Anthropic.APIConnectionError) throw new LlmError("Could not reach Anthropic (offline?)", { kind: "network", retryable: true });
        if (e instanceof Anthropic.APIError) throw new LlmError(`Anthropic error ${e.status ?? ""}: ${e.message}`.trim(), { kind: "error", retryable: (e.status ?? 0) >= 500, status: e.status });
        if (e?.name === "AbortError" || e instanceof Anthropic.APIUserAbortError) throw e;
        throw new LlmError(String(e?.message ?? e));
      }
      if (res.stop_reason === "refusal") throw new LlmError(`The model declined this page${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`, { kind: "refusal" });
      if (res.stop_reason === "max_tokens") throw new LlmError("The answer was cut off (too long for one page); try a smaller region", { kind: "cut-off" });
      const rawText = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return {
        json: parseJsonText(rawText), rawText, stopReason: res.stop_reason, model: res.model ?? model,
        usage: { inputTokens: res.usage?.input_tokens ?? null, outputTokens: res.usage?.output_tokens ?? null },
      };
    },
  };
}
