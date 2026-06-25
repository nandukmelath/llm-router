import { test } from "node:test";
import assert from "node:assert";
import { classify } from "../src/classify.js";

const cases = [
  // [prompt, expectedTier]
  ["translate 'hello' to French", 0],
  ["what is the capital of France?", 0],
  ["summarize this sentence in 5 words", 0],
  ["uppercase this: hello world", 0],
  ["write a python function to reverse a linked list", 1],
  ["debug this stack trace and explain the error", 1],
  ["compare REST and GraphQL for our API", 1],
  ["prove that the halting problem is undecidable", 2],
  ["design a distributed rate limiter handling race conditions and trade-offs", 2],
  ["derive the time complexity of this algorithm and optimize it for edge cases", 2],
];

test("classifier maps prompts to expected tiers", () => {
  for (const [p, want] of cases) {
    const { tier } = classify(p);
    assert.strictEqual(tier, want, `"${p}" -> got ${tier}, want ${want}`);
  }
});

test("minTier floor is respected", () => {
  const { tier } = classify("what is 2+2", { minTier: 1 });
  assert.ok(tier >= 1);
});

test("maxTier ceiling is respected", () => {
  const { tier } = classify("prove fermat's last theorem rigorously", { maxTier: 1 });
  assert.ok(tier <= 1);
});

test("returns signals and score", () => {
  const r = classify("write code to sort an array");
  assert.ok(typeof r.score === "number");
  assert.ok(r.signals.tokens > 0);
});
