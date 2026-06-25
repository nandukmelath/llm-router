import { test } from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, readFileSync } from "node:fs";
import { createCache, cacheKey } from "../src/cache.js";
import { createMetrics, summarize } from "../src/metrics.js";
import { getRegistry } from "../src/models.js";

test("cache stores and returns by key", () => {
  const c = createCache();
  const k = cacheKey({ provider: "anthropic", model: "m", system: "", prompt: "hi", maxTokens: 10 });
  assert.strictEqual(c.has(k), false);
  c.set(k, { text: "answer" });
  assert.strictEqual(c.has(k), true);
  assert.deepStrictEqual(c.get(k), { text: "answer" });
});

test("identical request => same key, different prompt => different key", () => {
  const a = cacheKey({ provider: "p", model: "m", system: "s", prompt: "x", maxTokens: 5 });
  const b = cacheKey({ provider: "p", model: "m", system: "s", prompt: "x", maxTokens: 5 });
  const d = cacheKey({ provider: "p", model: "m", system: "s", prompt: "y", maxTokens: 5 });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, d);
});

test("LRU eviction respects max", () => {
  const c = createCache({ max: 2 });
  c.set("a", 1); c.set("b", 2); c.set("c", 3); // evicts "a"
  assert.strictEqual(c.has("a"), false);
  assert.strictEqual(c.has("c"), true);
  assert.strictEqual(c.size, 2);
});

test("cache persists to disk and reloads", () => {
  const f = join(tmpdir(), `llmr-cache-${process.pid}.json`);
  rmSync(f, { force: true });
  const c1 = createCache({ file: f });
  c1.set("k", { text: "persisted" });
  const c2 = createCache({ file: f });
  assert.deepStrictEqual(c2.get("k"), { text: "persisted" });
  rmSync(f, { force: true });
});

test("metrics log + summarize rolls up cost and savings", () => {
  const f = join(tmpdir(), `llmr-metrics-${process.pid}.jsonl`);
  rmSync(f, { force: true });
  const m = createMetrics({ file: f });
  m.log({ tier: 0, model: "haiku", cached: false, cost: 0.001, usage: { in: 100, out: 200 } });
  m.log({ tier: 2, model: "opus",  cached: false, cost: 0.02,  usage: { in: 100, out: 200 } });
  m.log({ tier: 0, model: "haiku", cached: true,  cost: 0,     usage: { in: 0, out: 0 } });

  const s = summarize(f, getRegistry("anthropic"));
  assert.strictEqual(s.requests, 3);
  assert.strictEqual(s.cacheHits, 1);
  assert.ok(Math.abs(s.cacheHitRate - 1 / 3) < 1e-9);
  assert.strictEqual(s.byTier[0], 2);
  assert.ok(s.totalCost > 0);
  assert.ok(s.allHeavyBaseline >= s.totalCost); // baseline never cheaper
  rmSync(f, { force: true });
});
