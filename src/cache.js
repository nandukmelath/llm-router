import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Exact-match response cache. Keyed on the full request shape, so an identical
// prompt+model+system+maxTokens returns the stored answer for $0 / 0 tokens.
// Optional disk persistence (JSON). Zero deps.

export function cacheKey({ provider, model, system, prompt, maxTokens }) {
  const h = createHash("sha256");
  h.update(JSON.stringify({ provider, model, system: system || "", prompt, maxTokens }));
  return h.digest("hex");
}

export function createCache(opts = {}) {
  const { file, max = 1000 } = opts;
  let store = new Map();

  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      for (const [k, v] of raw) store.set(k, v);
    } catch { /* no file yet / unreadable -> start empty */ }
  }

  function persist() {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify([...store.entries()]));
    } catch { /* best-effort */ }
  }

  return {
    get(key) {
      if (!store.has(key)) return undefined;
      // LRU touch: re-insert to mark most-recent.
      const v = store.get(key);
      store.delete(key);
      store.set(key, v);
      return v;
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      store.set(key, value);
      while (store.size > max) store.delete(store.keys().next().value); // evict oldest
      persist();
    },
    has(key) { return store.has(key); },
    get size() { return store.size; },
    clear() { store.clear(); persist(); },
  };
}
