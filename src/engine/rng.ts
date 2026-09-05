// Deterministic PRNG (mulberry32), bit-for-bit the same as poc/engine.mjs makeRng so the
// parity suite can reproduce poc/results.json exactly, not just within noise.

export type Rng = () => number;

/** Returns a function producing uniform floats in [0, 1). Same seed, same sequence, everywhere. */
export function makeRng(seed = 1337): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
