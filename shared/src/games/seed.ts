// Daily seed: every room in the world gets the same puzzle on the same
// day. Endless mode reseeds per round through mulberry32.

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** FNV-1a, 32-bit, over UTF-16 code units (ASCII for dates) */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed for a day; accepts `YYYY-MM-DD` or a full ISO timestamp (date part only) */
export function dailySeed(dateISO: string): number {
  if (!DATE_RE.test(dateISO)) throw new RangeError(`not an ISO date: ${dateISO}`);
  return fnv1a(dateISO.slice(0, 10));
}

/** One step of mulberry32: pure, so state can live in a serialisable game state */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

/** mulberry32 PRNG: floats in [0, 1) */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    const r = nextRandom(state);
    state = r.state;
    return r.value;
  };
}

/**
 * The day's pick from a pool. The raw FNV hash of consecutive dates is
 * poorly spread mod small numbers, so it seeds mulberry32 first.
 */
export function pickDaily<T>(dateISO: string, pool: readonly T[]): T {
  if (pool.length === 0) throw new RangeError('empty pool');
  const i = Math.floor(mulberry32(dailySeed(dateISO))() * pool.length);
  return pool[i]!;
}
