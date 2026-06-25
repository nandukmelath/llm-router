import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// Append-only JSONL log of routing decisions. One line per request.
// Lets you audit where spend goes and tune the classifier from real traffic.

export function createMetrics(opts = {}) {
  const { file } = opts;

  function log(record) {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(record) + "\n");
    } catch { /* best-effort */ }
  }

  return { log };
}

// Read a JSONL metrics file and roll it up: counts + cost by tier/model,
// cache hit rate, and total spend (+ what an all-heavy baseline would cost).
export function summarize(file, registry) {
  let lines;
  try { lines = readFileSync(file, "utf8").split("\n").filter(Boolean); }
  catch { return { error: `cannot read ${file}` }; }

  const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byTier = {}, byModel = {};
  let total = 0, cacheHits = 0, baseline = 0;

  for (const r of rows) {
    byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    byModel[r.model] = (byModel[r.model] || 0) + 1;
    total += r.cost || 0;
    if (r.cached) cacheHits++;
    // Baseline = same token usage billed at the heavy (tier 2) price.
    if (registry && r.usage) {
      const heavy = registry[2].price;
      baseline += (r.usage.in / 1e6) * heavy.in + (r.usage.out / 1e6) * heavy.out;
    }
  }

  return {
    requests: rows.length,
    cacheHits,
    cacheHitRate: rows.length ? cacheHits / rows.length : 0,
    byTier,
    byModel,
    totalCost: total,
    allHeavyBaseline: baseline || undefined,
    savedVsHeavy: baseline ? baseline - total : undefined,
  };
}
