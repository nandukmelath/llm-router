import { test } from "node:test";
import assert from "node:assert";
import { route } from "../src/router.js";
import { getRegistry, estimateCost, REGISTRIES } from "../src/models.js";

// route() with escalate:false stays fully offline (no API key needed).

test("resolves model per registry", async () => {
  const a = await route("translate hi to French", { registry: "anthropic", escalate: false });
  assert.strictEqual(a.provider, "anthropic");
  assert.match(a.model, /haiku/);

  const g = await route("translate hi to French", { registry: "groq", escalate: false });
  assert.strictEqual(g.provider, "groq");
});

test("budget cap downgrades heavy -> cheaper tier", async () => {
  // Heavy prompt would pick tier 2 (Opus). Tiny budget forces a downgrade.
  const r = await route("design a distributed lock with race conditions and trade-offs", {
    registry: "anthropic", escalate: false, budget: 0.002, maxTokens: 1000,
  });
  assert.ok(r.tier < 2, `expected downgrade, got tier ${r.tier}`);
  assert.strictEqual(r.method, "budget-capped");
  assert.ok(r.budgeted);
});

test("budget cap respects minTier floor", async () => {
  const r = await route("design a distributed system with trade-offs", {
    registry: "anthropic", escalate: false, budget: 0.000001, minTier: 1, maxTokens: 1000,
  });
  assert.ok(r.tier >= 1);
  assert.ok(r.budgetExceeded, "cheapest allowed tier still over budget -> flagged");
});

test("generous budget keeps heavy tier", async () => {
  const r = await route("prove the halting problem is undecidable rigorously", {
    registry: "anthropic", escalate: false, budget: 100, maxTokens: 1000,
  });
  assert.strictEqual(r.tier, 2);
  assert.ok(!r.budgeted);
});

test("estimateCost math", () => {
  const t = getRegistry("anthropic")[2];
  // 1000 in + 1000 out at 15/75 per 1M
  const c = estimateCost(t, 1000, 1000);
  assert.ok(Math.abs(c - (0.015 + 0.075)) < 1e-9);
});

test("every registry has 3 well-formed tiers", () => {
  for (const [name, reg] of Object.entries(REGISTRIES)) {
    for (const tier of [0, 1, 2]) {
      const t = reg[tier];
      assert.ok(t, `${name} missing tier ${tier}`);
      assert.ok(t.provider && t.model && t.name, `${name}.${tier} malformed`);
      assert.ok(t.price.in >= 0 && t.price.out >= 0, `${name}.${tier} bad price`);
    }
  }
});
