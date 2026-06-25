#!/usr/bin/env node
import { route, chat } from "./router.js";
import { getRegistry } from "./models.js";
import { summarize } from "./metrics.js";

const args = process.argv.slice(2);

// Subcommand: stats <metrics.jsonl> [--registry NAME]
if (args[0] === "stats") {
  const file = args[1];
  const ri = args.indexOf("--registry");
  const reg = ri >= 0 ? args[ri + 1] : "anthropic";
  if (!file) { console.error("usage: llm-router stats <metrics.jsonl> [--registry NAME]"); process.exit(1); }
  const s = summarize(file, getRegistry(reg));
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--run") flags.run = true;
  else if (a === "--stream") { flags.run = true; flags.stream = true; }
  else if (a === "--no-escalate") flags.noEscalate = true;
  else if (a === "--json") flags.json = true;
  else if (a === "--min") flags.min = Number(args[++i]);
  else if (a === "--max") flags.max = Number(args[++i]);
  else if (a === "--registry") flags.registry = args[++i];
  else if (a === "--budget") flags.budget = Number(args[++i]);
  else if (a === "--max-tokens") flags.maxTokens = Number(args[++i]);
  else if (a === "--system") flags.system = args[++i];
  else if (a === "--cache") { const n = args[i + 1]; if (n && !n.startsWith("-")) flags.cache = args[++i]; else flags.cache = true; }
  else if (a === "--metrics") flags.metrics = args[++i];
  else if (a === "-h" || a === "--help") flags.help = true;
  else rest.push(a);
}

function help() {
  console.log(`llm-router — route a prompt to the right-sized model.

Usage:
  llm-router "<prompt>"            classify + show chosen model (no API call)
  llm-router --run "<prompt>"      route AND run the model
  llm-router --stream "<prompt>"   route + stream tokens live
  echo "<prompt>" | llm-router     read prompt from stdin

Flags:
  --registry NAME  anthropic | openai | groq | openrouter | mixed  (default anthropic)
  --run            call the model (needs the provider's API key env var)
  --stream         stream output token-by-token
  --budget USD     per-request cost ceiling; downgrades tier to fit
  --max-tokens N   output token cap (default 1024; also used for budgeting)
  --min N / --max N  clamp tier (0|1|2)
  --no-escalate    heuristic only, never call the LLM judge
  --cache [PATH]   exact-match response cache (PATH persists to disk)
  --metrics PATH   append each decision to a JSONL log
  --system "..."   system prompt for --run
  --json           machine-readable output

Subcommands:
  llm-router stats <metrics.jsonl> [--registry NAME]   roll up cost + savings
`);
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let d = "";
  for await (const c of process.stdin) d += c;
  return d.trim();
}

const prompt = rest.join(" ").trim();
const p = prompt || (await readStdin());
if (flags.help || !p) { help(); process.exit(0); }

const opts = {
  registry: flags.registry,
  escalate: !flags.noEscalate,
  minTier: flags.min,
  maxTier: flags.max,
  budget: flags.budget,
  maxTokens: flags.maxTokens,
};

if (flags.run) {
  const { text, usage, actualCost, cached, routing } = await chat(p, {
    ...opts,
    system: flags.system,
    stream: flags.stream,
    cache: flags.cache,
    metrics: flags.metrics,
    onToken: flags.stream && !flags.json ? (t) => process.stdout.write(t) : undefined,
  });
  if (flags.json) {
    console.log(JSON.stringify({ routing, usage, actualCost, cached, text }, null, 2));
  } else {
    if (!flags.stream || cached) {
      console.error(tag(routing, actualCost, cached));
      console.log(text);
    } else {
      process.stdout.write("\n");
      console.error(tag(routing, actualCost, cached));
    }
  }
} else {
  // Dry-run. Needs a key only to resolve the judge; falls back to heuristic.
  const reg = getRegistry(opts.registry);
  const judgeEnv = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" }[reg[0].provider];
  const r = await route(p, { ...opts, escalate: opts.escalate && !!process.env[judgeEnv] });
  if (flags.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`tier:    ${r.tier} (${r.tierName})`);
    console.log(`model:   ${r.provider}/${r.model}`);
    console.log(`method:  ${r.method}`);
    console.log(`score:   ${r.score}  confident: ${r.confident}`);
    if (r.estCost != null) console.log(`est cost: $${r.estCost.toFixed(5)}${r.budgetExceeded ? "  (OVER BUDGET)" : ""}`);
    console.log(`signals: ${JSON.stringify(r.signals)}`);
  }
}

function tag(r, cost, cached) {
  const c = cost != null ? ` · $${cost.toFixed(5)}` : "";
  const h = cached ? " · CACHED" : "";
  return `[${r.tierName} · ${r.provider}/${r.model} · ${r.method}${c}${h}]`;
}
