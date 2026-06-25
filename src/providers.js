import { PROVIDERS } from "./models.js";

// Unified call layer over Anthropic + OpenAI-compatible APIs.
// Returns { text, usage:{in,out} }. Streams via onToken(delta) when stream:true.

export async function callModel(opts) {
  const { provider, model, system, messages, maxTokens = 1024, stream, onToken } = opts;
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider "${provider}"`);
  const apiKey = opts.apiKey || process.env[p.keyEnv];
  if (!apiKey) throw new Error(`${p.keyEnv} not set`);
  const url = opts.baseURL || p.url;

  if (p.kind === "anthropic") {
    return anthropicCall({ url, apiKey, model, system, messages, maxTokens, stream, onToken });
  }
  return openaiCall({ url, apiKey, model, system, messages, maxTokens, stream, onToken });
}

// ---- Anthropic ----
async function anthropicCall({ url, apiKey, model, system, messages, maxTokens, stream, onToken }) {
  const body = { model, max_tokens: maxTokens, messages, stream: !!stream };
  if (system) body.system = system;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);

  if (!stream) {
    const d = await res.json();
    return {
      text: (d.content || []).map((b) => b.text || "").join(""),
      usage: { in: d.usage?.input_tokens ?? 0, out: d.usage?.output_tokens ?? 0 },
    };
  }
  let text = "", usage = { in: 0, out: 0 };
  await readSSE(res, (evt) => {
    const j = safeJSON(evt);
    if (!j) return;
    if (j.type === "content_block_delta" && j.delta?.text) { text += j.delta.text; onToken?.(j.delta.text); }
    if (j.type === "message_start" && j.message?.usage) usage.in = j.message.usage.input_tokens ?? 0;
    if (j.type === "message_delta" && j.usage) usage.out = j.usage.output_tokens ?? usage.out;
  });
  return { text, usage };
}

// ---- OpenAI-compatible (OpenAI, Groq, OpenRouter, local) ----
async function openaiCall({ url, apiKey, model, system, messages, maxTokens, stream, onToken }) {
  const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
  const body = { model, messages: msgs, max_tokens: maxTokens, stream: !!stream };
  if (stream) body.stream_options = { include_usage: true };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);

  if (!stream) {
    const d = await res.json();
    return {
      text: d.choices?.[0]?.message?.content ?? "",
      usage: { in: d.usage?.prompt_tokens ?? 0, out: d.usage?.completion_tokens ?? 0 },
    };
  }
  let text = "", usage = { in: 0, out: 0 };
  await readSSE(res, (evt) => {
    if (evt === "[DONE]") return;
    const j = safeJSON(evt);
    if (!j) return;
    const delta = j.choices?.[0]?.delta?.content;
    if (delta) { text += delta; onToken?.(delta); }
    if (j.usage) usage = { in: j.usage.prompt_tokens ?? 0, out: j.usage.completion_tokens ?? 0 };
  });
  return { text, usage };
}

// ---- SSE reader (shared) ----
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
