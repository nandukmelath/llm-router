// Heuristic prompt-complexity classifier. Free, deterministic, no API call.
// Returns { tier, score, signals, confident }.
//
// Idea: reasoning power needed correlates with detectable signals in the
// prompt. Score them, map to a tier. Only when the score lands near a tier
// boundary do we flag `confident:false` so the caller can escalate to a
// cheap LLM judge.

const RE = {
  // High-reasoning intent verbs/phrases.
  heavy: /\b(prove|proof|derive|theorem|formally|rigorous|optimi[sz]e|complexity|algorithm|architect(ure)?|design (a|the|an) system|trade[- ]?offs?|root[- ]?cause|reason (through|about)|step[- ]by[- ]step|chain of thought|why does|explain why|analy[sz]e deeply|edge cases?|concurren(t|cy)|race condition|distributed|cryptograph|formal verification|np[- ]hard)\b/i,
  // Medium intent: real work but not deep.
  medium: /\b(code|function|implement|debug|fix|refactor|write a (script|program|test)|explain|compare|summari[sz]e the|plan|design|sql|regex|api|class|module|stack trace|error|bug)\b/i,
  // Low intent: trivial transforms.
  light: /\b(translate|rephrase|reword|capitali[sz]e|lowercase|uppercase|format|list|define|what is|who is|when (is|was|did)|spell|synonym|antonym|emoji|tl;?dr|shorten)\b/i,
  code: /```|\bdef |\bfunction |\bclass |=>|\bimport |\bSELECT \b|\b#include\b|{\s*$/m,
  math: /[∫∑∏√≤≥≠∈∀∃πθλ]|\\frac|\\sum|\\int|\b\d+\s*[\^]\s*\d+|matrix|eigen|derivative|integral/i,
  multipart: /\b(and then|after that|step \d|first,|second,|finally,|\d\.\s)/i,
  question: /\?/g,
};

function approxTokens(s) {
  return Math.ceil(s.length / 4);
}

export function classify(prompt, opts = {}) {
  const text = String(prompt || "");
  const tokens = approxTokens(text);
  const signals = {};
  let score = 0;

  // Intent verbs (strongest signal).
  if (RE.heavy.test(text)) { score += 5; signals.heavy = true; }
  if (RE.medium.test(text)) { score += 2; signals.medium = true; }
  if (RE.light.test(text)) { score -= 2; signals.light = true; }

  // Structural signals.
  if (RE.code.test(text)) { score += 2; signals.code = true; }
  if (RE.math.test(text)) { score += 3; signals.math = true; }
  if (RE.multipart.test(text)) { score += 1; signals.multipart = true; }

  const qs = (text.match(RE.question) || []).length;
  if (qs >= 3) { score += 1; signals.manyQuestions = qs; }

  // Length: long prompts usually carry more context/constraints.
  if (tokens > 800) { score += 2; signals.long = tokens; }
  else if (tokens > 250) { score += 1; signals.mid = tokens; }
  else if (tokens < 12 && !signals.heavy && !signals.math) { score -= 1; signals.tiny = tokens; }

  signals.tokens = tokens;

  // Map score -> tier. Boundaries: <=0 light, 1..4 balanced, >=5 heavy.
  let tier;
  if (score <= 0) tier = 0;
  else if (score <= 4) tier = 1;
  else tier = 2;

  // Confidence: low when score sits on a boundary.
  const nearBoundary = score === 0 || score === 1 || score === 4 || score === 5;
  const confident = !nearBoundary;

  // Hard floor/ceiling overrides from caller.
  if (opts.minTier != null) tier = Math.max(tier, opts.minTier);
  if (opts.maxTier != null) tier = Math.min(tier, opts.maxTier);

  return { tier, score, signals, confident };
}
