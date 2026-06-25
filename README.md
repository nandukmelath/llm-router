# llm-router

Route each prompt to the **smallest model strong enough for it**. Cheap prompts go to Haiku, real work to Sonnet, hard reasoning to Opus. Cuts spend 70–90% on mixed traffic vs. sending everything to one big model.

## How it works

Two-stage decision, cheapest-first:

1. **Heuristic classifier** (free, no API call). Scores reasoning-power signals in the prompt — intent verbs (`prove`, `derive`, `optimize`, `architect` vs. `translate`, `format`, `define`), code blocks, math, multi-part structure, length. Maps the score to a tier.
2. **LLM judge** (optional). Only when the heuristic lands near a tier boundary (`confident:false`) does it ask the *cheapest* model to classify — a ~2-token call. Far cheaper than mis-routing a hard prompt to a weak model, or an easy one to Opus.

Tiers per registry (`src/models.js`):

| Tier | Name | anthropic | openai | groq |
|---|---|---|---|---|
| 0 | light | Haiku | gpt-4o-mini | llama-3.1-8b-instant |
| 1 | balanced | Sonnet | gpt-4o | llama-3.3-70b |
| 2 | heavy | Opus | o3 | deepseek-r1-distill-70b |

Pick with `registry: "groq"` etc. `mixed` uses cheap Groq for easy work and
Anthropic Opus for hard. Tiers can mix providers freely. Edit/extend in
`src/models.js`, or pass your own registry object.

## Providers

Provider-agnostic. Built-in: **anthropic**, **openai**, **groq**, **openrouter**
(any OpenAI-compatible endpoint works via `baseURL`). Each tier names its
provider; the call layer (`src/providers.js`) speaks both the Anthropic and
OpenAI wire formats. Keys read from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`GROQ_API_KEY` / `OPENROUTER_API_KEY`.

## Streaming

```js
await chat("explain TCP handshake", { stream: true, onToken: (t) => process.stdout.write(t) });
```
CLI: `node src/cli.js --stream "..."`. Returns full `text` + token `usage` when done.

## Budget caps

Set a per-request USD ceiling. The router estimates cost for the chosen tier and
**downgrades** until it fits (respecting `minTier`). If even the lowest allowed
tier exceeds the budget, `budgetExceeded:true` is flagged — pass
`strictBudget:true` to throw instead of running anyway.

```js
await chat("...", { budget: 0.01, maxTokens: 1000, strictBudget: true });
```
CLI: `node src/cli.js --budget 0.01 --max-tokens 1000 "..."`. `chat()` also
returns `actualCost` computed from real token usage.

## Install

Zero dependencies. Node 18+ (uses built-in `fetch` + `node:test`).

```bash
cd llm-router
node --test          # run tests
```

Set a key to actually run models (routing decisions work without one):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## CLI

```bash
# Dry-run: classify + show chosen model, no model call
node src/cli.js "translate hello to French"
node src/cli.js "design a distributed lock handling race conditions"

# Route AND run the model, print the answer
node src/cli.js --run "write a regex for emails"

# Force bounds / disable the judge / JSON out
node src/cli.js --min 1 --max 2 "..."     # never use Haiku, never above Opus
node src/cli.js --no-escalate "..."        # heuristic only
node src/cli.js --json "..."

echo "summarize this" | node src/cli.js    # stdin
```

## Library

```js
import { route, chat, classify } from "./index.js";

// Decision only
const r = await route("prove the halting problem is undecidable", { registry: "anthropic" });
// { tier:2, tierName:'heavy', provider:'anthropic', model:'claude-opus-4-8', ... }

// Route + run in one call (streaming + budget optional)
const { text, usage, actualCost, routing } = await chat("write a bubble sort in Go", {
  registry: "mixed",
  maxTokens: 800,
  budget: 0.02,
  stream: true,
  onToken: (t) => process.stdout.write(t),
  // minTier, maxTier, escalate, system, baseURL, apiKey, strictBudget all optional
});

// Pure heuristic (sync, free) — embed in your own gateway
const { tier, score, signals, confident } = classify(promptString);
```

## Options

- `escalate` (default `true`) — call the LLM judge when unsure. Set `false` for fully free, fully deterministic routing.
- `minTier` / `maxTier` — clamp routing. e.g. `minTier:1` to never touch the weakest model on quality-sensitive traffic.
- `apiKey` — override `ANTHROPIC_API_KEY`.

## Response cache

Exact-match cache keyed on `{provider, model, system, prompt, maxTokens}` (sha256).
An identical repeat request returns the stored answer for **$0 / 0 tokens**. LRU
eviction, optional disk persistence.

```js
import { chat, createCache } from "./index.js";
const cache = createCache({ file: ".llm-router/cache.json", max: 5000 });
const { text, cached } = await chat("define entropy", { cache });
// pass a path string or `true` instead of an instance for convenience
```
CLI: `node src/cli.js --cache .llm-router/cache.json --run "..."` (tag shows `CACHED` on hits).

## Metrics

Append every routing decision to a JSONL log, then roll it up — see where spend
goes, cache hit rate, and savings vs. an all-heavy baseline.

```js
const { actualCost } = await chat("...", { metrics: ".llm-router/metrics.jsonl" });

import { summarize } from "./index.js";
import { getRegistry } from "./src/models.js";
summarize(".llm-router/metrics.jsonl", getRegistry("anthropic"));
// { requests, cacheHits, cacheHitRate, byTier, byModel, totalCost, allHeavyBaseline, savedVsHeavy }
```
CLI: `node src/cli.js --metrics .llm-router/metrics.jsonl --run "..."` then
`node src/cli.js stats .llm-router/metrics.jsonl`.

## Tuning

The classifier is transparent and regex-driven (`src/classify.js`). Adjust the
keyword sets and score weights to your workload, then run `node --test` —
`test/classify.test.js` pins tier expectations for representative prompts. Add
your own prompts there as a regression suite.

## License

MIT
