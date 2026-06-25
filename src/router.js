import { classify } from "./classify.js";
import { getRegistry, judgeTier, estimateCost, REGISTRIES } from "./models.js";
import { callModel } from "./providers.js";
import { createCache, cacheKey } from "./cache.js";
import { createMetrics } from "./metrics.js";

const approxTokens = (s) => Math.ceil(String(s).length / 4);

// Decide tier + concrete model for a prompt.
// Order: free heuristic -> optional LLM judge (only if unsure) -> budget cap.
export async function route(prompt, opts = {}) {
  const {
    registry: regName,
    minTier,
    maxTier,
    escalate = true,
    budget,                 // USD ceiling for this request (optional)
    maxTokens = 1024,       // output estimate for budgeting
    apiKey,
  } = opts;

  const registry = getRegistry(regName);
  const h = classify(prompt, { minTier, maxTier });
  let tier = h.tier;
  let method = "heuristic";

  // Escalate to cheap judge when heuristic is unsure.
  const judge = judgeTier(registry);
  const judgeKey = apiKey || process.env[providerKeyEnv(judge.provider)];
  if (!h.confident && escalate && judgeKey) {
    try {
      const j = await llmJudge(prompt, judge, apiKey);
      if (j != null) {
        tier = j;
        if (minTier != null) tier = Math.max(tier, minTier);
        if (maxTier != null) tier = Math.min(tier, maxTier);
        method = "llm-judge";
      }
    } catch { /* keep heuristic */ }
  }

  // Budget cap: downgrade until the estimate fits, respecting minTier floor.
  let budgeted = false, budgetExceeded = false;
  if (budget != null) {
    const inTok = approxTokens(prompt);
    const floor = minTier ?? 0;
    while (tier > floor && estimateCost(registry[tier], inTok, maxTokens) > budget) {
      tier--; budgeted = true; method = "budget-capped";
    }
    if (estimateCost(registry[tier], inTok, maxTokens) > budget) budgetExceeded = true;
  }

  const cfg = registry[tier];
  return {
    tier,
    tierName: cfg.name,
    provider: cfg.provider,
    model: cfg.model,
    method,
    score: h.score,
    confident: h.confident,
    signals: h.signals,
    estCost: budget != null ? estimateCost(cfg, approxTokens(prompt), maxTokens) : undefined,
    budgeted,
    budgetExceeded,
  };
}

// Full pipeline: route then run the chosen model. Supports streaming,
// exact-match response cache, and JSONL metrics logging.
export async function chat(prompt, opts = {}) {
  const r = await route(prompt, opts);
  if (r.budgetExceeded && opts.strictBudget) {
    throw new Error(`budget $${opts.budget} too low even for cheapest tier (est $${r.estCost.toFixed(5)})`);
  }

  const maxTokens = opts.maxTokens ?? 1024;
  const cache = resolveCache(opts.cache);
  const metrics = resolveMetrics(opts.metrics);
  const key = cache
    ? cacheKey({ provider: r.provider, model: r.model, system: opts.system, prompt: String(prompt), maxTokens })
    : null;

  // Cache hit: $0, no tokens, no model call.
  if (cache && cache.has(key)) {
    const hit = cache.get(key);
    metrics?.log({ tier: r.tier, model: r.model, provider: r.provider, method: r.method, cached: true, cost: 0, usage: { in: 0, out: 0 } });
    return { text: hit.text, usage: { in: 0, out: 0 }, actualCost: 0, cached: true, routing: r };
  }

  const { text, usage } = await callModel({
    provider: r.provider,
    model: r.model,
    system: opts.system,
    messages: [{ role: "user", content: String(prompt) }],
    maxTokens,
    stream: opts.stream,
    onToken: opts.onToken,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
  });
  const actualCost = estimateCostFromUsage(r, usage);

  if (cache) cache.set(key, { text });
  metrics?.log({ tier: r.tier, model: r.model, provider: r.provider, method: r.method, cached: false, cost: actualCost ?? 0, usage });

  return { text, usage, actualCost, cached: false, routing: r };
}

// Accept a cache instance, a file path, or true (in-memory).
function resolveCache(c) {
  if (!c) return null;
  if (typeof c === "object" && typeof c.get === "function") return c;
  if (c === true) return createCache();
  if (typeof c === "string") return createCache({ file: c });
  return null;
}

function resolveMetrics(m) {
  if (!m) return null;
  if (typeof m === "object" && typeof m.log === "function") return m;
  if (typeof m === "string") return createMetrics({ file: m });
  return null;
}

async function llmJudge(prompt, judgeCfg, apiKey) {
  const system =
    "You are a routing classifier. Output ONLY one digit for the reasoning " +
    "power the prompt needs: 0 = trivial (lookup, format, translate, short " +
    "answer), 1 = moderate (coding, multi-step explanation, analysis), " +
    "2 = hard (proofs, system design, deep debugging, complex math/logic). " +
    "Digit only.";
  const { text } = await callModel({
    provider: judgeCfg.provider,
    model: judgeCfg.model,
    system,
    messages: [{ role: "user", content: String(prompt).slice(0, 4000) }],
    maxTokens: 2,
    apiKey,
  });
  const m = text.match(/[012]/);
  return m ? Number(m[0]) : null;
}

function providerKeyEnv(provider) {
  return { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" }[provider];
}

function estimateCostFromUsage(routing, usage) {
  const price = priceFor(routing.provider, routing.model);
  if (!price) return undefined;
  return (usage.in / 1e6) * price.in + (usage.out / 1e6) * price.out;
}

// Real cost from token usage via price lookup across registries.
function priceFor(provider, model) {
  for (const reg of Object.values(REGISTRIES)) {
    for (const t of Object.values(reg)) {
      if (t.provider === provider && t.model === model) return t.price;
    }
  }
  return null;
}

export { classify, estimateCost, getRegistry, createCache, createMetrics };
