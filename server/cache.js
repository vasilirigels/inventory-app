// Memory cache i thjeshtë me TTL për endpoint-e hot GET.
// Objektivi: ulje e row-reads te Turso për të mbetur brenda free plan-it.
//
// Përdorimi:
//   import { cache } from './cache.js';
//   const cached = cache.get('products:all');
//   if (cached) return res.json(cached);
//   const rows = await queryAll(...);
//   cache.set('products:all', rows, 30_000); // 30s TTL
//   res.json(rows);
//
// Invalidim (thirret nga POST/PUT/DELETE që preku tabelën):
//   cache.invalidate('products');       // fshin çdo çelës që fillon me 'products'
//   cache.invalidate();                 // fshin gjithçka (rrallë)

const store = new Map(); // key → { value, expiresAt }

function now() { return Date.now(); }

export const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  set(key, value, ttlMs) {
    store.set(key, { value, expiresAt: now() + (ttlMs || 30_000) });
  },

  // Fshi çelësa që fillojnë me prefix-in e dhënë. Pa argument → fshi gjithçka.
  invalidate(prefix) {
    if (!prefix) { store.clear(); return; }
    for (const k of store.keys()) {
      if (k === prefix || k.startsWith(prefix + ':')) store.delete(k);
    }
  },

  size() { return store.size; },
};

// Wrapper që ekzekuton loader-in vetëm nëse cache s'e ka çelësin (ose ka skaduar).
// Përdorimi:
//   const rows = await cached('products:all', 30_000, () => queryAll(...));
export async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit !== null) return hit;
  const value = await loader();
  cache.set(key, value, ttlMs);
  return value;
}
