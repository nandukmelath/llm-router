// Model registries. A registry = 3 tiers (0 light, 1 balanced, 2 heavy),
// each with a provider, model id, $/1M-token price, and key/baseURL config.
//
// Pick a preset by name or pass your own. Tiers can mix providers
// (e.g. cheap Groq light tier + Anthropic heavy tier).

export const PROVIDERS = {
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    keyEnv: "ANTHROPIC_API_KEY",
    kind: "anthropic",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    keyEnv: "OPENAI_API_KEY",
    kind: "openai",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    kind: "openai",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    kind: "openai",
  },
};

// price = USD per 1M tokens. Update as vendors change pricing.
export const REGISTRIES = {
  anthropic: {
    0: { provider: "anthropic", model: "claude-haiku-4-5-20251001", name: "light",    price: { in: 1.0,  out: 5.0 } },
    1: { provider: "anthropic", model: "claude-sonnet-4-6",         name: "balanced", price: { in: 3.0,  out: 15.0 } },
    2: { provider: "anthropic", model: "claude-opus-4-8",           name: "heavy",    price: { in: 15.0, out: 75.0 } },
  },
  openai: {
    0: { provider: "openai", model: "gpt-4o-mini", name: "light",    price: { in: 0.15, out: 0.6 } },
    1: { provider: "openai", model: "gpt-4o",      name: "balanced", price: { in: 2.5,  out: 10.0 } },
    2: { provider: "openai", model: "o3",          name: "heavy",    price: { in: 2.0,  out: 8.0 } },
  },
  groq: {
    0: { provider: "groq", model: "llama-3.1-8b-instant",  name: "light",    price: { in: 0.05, out: 0.08 } },
    1: { provider: "groq", model: "llama-3.3-70b-versatile", name: "balanced", price: { in: 0.59, out: 0.79 } },
    2: { provider: "groq", model: "deepseek-r1-distill-llama-70b", name: "heavy", price: { in: 0.75, out: 0.99 } },
  },
  // Mixed example: free/cheap Groq for easy work, Anthropic Opus for hard.
  mixed: {
    0: { provider: "groq",      model: "llama-3.1-8b-instant", name: "light",    price: { in: 0.05, out: 0.08 } },
    1: { provider: "anthropic", model: "claude-sonnet-4-6",    name: "balanced", price: { in: 3.0,  out: 15.0 } },
    2: { provider: "anthropic", model: "claude-opus-4-8",      name: "heavy",    price: { in: 15.0, out: 75.0 } },
  },
};

export function getRegistry(reg) {
  if (reg && typeof reg === "object") return reg;        // custom passed in
  const r = REGISTRIES[reg || "anthropic"];
  if (!r) throw new Error(`unknown registry "${reg}". have: ${Object.keys(REGISTRIES).join(", ")}`);
  return r;
}

// Cheapest tier of a registry is used for the LLM tie-breaker judge.
export function judgeTier(registry) {
  return registry[0];
}

// USD cost estimate for a tier given token counts.
export function estimateCost(tierCfg, inTokens, outTokens) {
  return (inTokens / 1e6) * tierCfg.price.in + (outTokens / 1e6) * tierCfg.price.out;
}

// Back-compat: default Anthropic tiers.
export const TIERS = REGISTRIES.anthropic;
