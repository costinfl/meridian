import { createAnthropicClient } from "./anthropic.js";
import { createOpenAiClient } from "./openai.js";
export { LlmError, toBase64, apiSchemaOf } from "./common.js";

/** The client for the provider chosen in AI settings. */
export function clientFor(settings, options = {}) {
  const provider = settings.provider;
  const opts = { apiKey: settings.keys[provider], model: settings.models[provider], ...options };
  if (provider === "anthropic") return createAnthropicClient(opts);
  if (provider === "openai") return createOpenAiClient(opts);
  throw new Error(`unknown provider: ${provider}`);
}
