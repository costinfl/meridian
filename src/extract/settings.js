// AI settings (P6.T3): provider, model, API key per provider and the page limit per batch. Kept ONLY in the
// device-local `settings` store (IndexedDB), never in the project, bundles, exports or logs (I9).

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic Claude",
    defaultModel: "claude-opus-5-5",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    keyHint: "sk-ant-…",
    host: "api.anthropic.com",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "",            // typed by the user: model names change too often to hard-code one
    models: [],
    keyHint: "sk-…",
    host: "api.openai.com",
  },
};
export const DEFAULT_MAX_PAGES = 10;
const KEY = "aiSettings";

/** { provider, models: { anthropic, openai }, keys: { anthropic, openai }, maxPages } */
export async function getAiSettings(storage) {
  const s = (await storage.getSetting(KEY)) ?? {};
  return {
    provider: PROVIDERS[s.provider] ? s.provider : "anthropic",
    models: { anthropic: s.models?.anthropic || PROVIDERS.anthropic.defaultModel, openai: s.models?.openai || "" },
    keys: { anthropic: s.keys?.anthropic || "", openai: s.keys?.openai || "" },
    maxPages: Number.isInteger(s.maxPages) && s.maxPages > 0 ? s.maxPages : DEFAULT_MAX_PAGES,
  };
}

export async function saveAiSettings(storage, patch) {
  const cur = await getAiSettings(storage);
  const next = {
    provider: patch.provider ?? cur.provider,
    models: { ...cur.models, ...(patch.models ?? {}) },
    keys: { ...cur.keys, ...(patch.keys ?? {}) },
    maxPages: patch.maxPages ?? cur.maxPages,
  };
  if (!PROVIDERS[next.provider]) throw new Error(`unknown provider: ${next.provider}`);
  if (!(Number.isInteger(next.maxPages) && next.maxPages > 0 && next.maxPages <= 200)) throw new Error("the page limit must be a whole number from 1 to 200");
  await storage.putSetting(KEY, next);
  return next;
}

/** What the chosen provider needs before a call can be made, or "" when ready. */
export function missingSetup(s) {
  if (!s.keys[s.provider]) return `Add your ${PROVIDERS[s.provider].label} API key in AI settings.`;
  if (!s.models[s.provider]) return `Choose a ${PROVIDERS[s.provider].label} model in AI settings.`;
  return "";
}

/** A key shown safely: first 6 and last 4 characters. */
export const maskKey = (k) => (!k ? "" : k.length <= 12 ? "•".repeat(k.length) : `${k.slice(0, 6)}…${k.slice(-4)}`);
