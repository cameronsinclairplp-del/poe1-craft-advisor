// Roll engine. Line-by-line port of poc/engine.mjs §3 (roll engine) plus estimate() and
// describeTarget() from §5, over the PoolFile types. Behaviour is identical to the POC: same
// rng call order, same draw order, same summation order, same comparisons, so the parity suite
// can reproduce poc/results.json bit for bit with the same seed. Anything here that the game
// data or the brief does not state is marked // VERIFY, exactly as in the POC.

import { poolModById } from "./pool.ts";
import { makeRng, type Rng } from "./rng.ts";
import type { KOfPick, PoolInfo, PoolMod, SimplePick, Target, TargetPick } from "./types.ts";

// How many affixes a freshly rolled rare gets. Weights 8:3:1 for 4/5/6 is the
// community-accepted datamined split (jewels differ).            // VERIFY against CoE
//
// ORDERED [count, weight] pairs. The POC keeps these in an object ({ 4: 8, 5: 3, 6: 1 }) and
// walks Object.entries, which puts integer keys in ascending order; this array is that exact
// order made explicit so nothing depends on object key ordering.
export const AFFIX_COUNT_WEIGHTS: ReadonlyArray<readonly [count: number, weight: number]> = [
  [4, 8],
  [5, 3],
  [6, 1],
];

/** Exactly one rng() call. Walks AFFIX_COUNT_WEIGHTS in order; falls back to 4 like the POC. */
export function pickAffixCount(rng: Rng): number {
  const total = AFFIX_COUNT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [n, w] of AFFIX_COUNT_WEIGHTS) if ((r -= w) < 0) return n;
  return 4;
}

/**
 * Roll a rare from scratch (chaos / alch / essence). `forced` mods are placed first,
 * then the remaining slots are filled by weighted draws from what is still eligible.
 * Returns the list of mods on the item.
 *
 * One draw at a time, weighted, no repeated group, max 3 per side. The eligible list and its
 * weight total are rebuilt in poolInfo.pool order before every draw, as in the POC.
 */
export function rollRare(poolInfo: PoolInfo, rng: Rng, forced: readonly PoolMod[] = []): PoolMod[] {
  const { pool } = poolInfo;
  const n = pickAffixCount(rng); // VERIFY: forced essence mod counts inside n (assumed here)
  const item: PoolMod[] = [];
  const usedGroups = new Set<string>();
  // The item's tag set grows as placed mods add tags (adds_tags). Nothing reads it yet: weights
  // are resolved once at buildPool time against the base tags, so a tag added mid-roll cannot
  // enable or re-weight later draws. Kept so a later port of adds_tags-dependent weights has
  // the hook, exactly as the POC keeps it.
  const tags = new Set<string>(poolInfo.tags);
  let prefixes = 0;
  let suffixes = 0;

  const place = (m: PoolMod): void => {
    item.push(m);
    usedGroups.add(m.group);
    if (m.side === "prefix") prefixes++;
    else suffixes++;
    for (const t of m.addsTags) tags.add(t);
  };
  for (const m of forced) place(m);

  while (item.length < n) {
    // eligible = rollable, right side not full, group not used
    let total = 0;
    const elig: PoolMod[] = [];
    for (const m of pool) {
      if (m.essenceOnly) continue;
      if (usedGroups.has(m.group)) continue;
      if (m.side === "prefix" && prefixes >= 3) continue;
      if (m.side === "suffix" && suffixes >= 3) continue;
      elig.push(m);
      total += m.weight;
    }
    if (!elig.length) break;
    let r = rng() * total;
    for (const m of elig) {
      if ((r -= m.weight) < 0) {
        place(m);
        break;
      }
    }
  }
  return item;
}

/** POC: `t.kOf != null` decides which kind of pick this is. */
const isKOf = (t: TargetPick): t is KOfPick => (t as Partial<KOfPick>).kOf != null;

/**
 * Target = list of picks. A pick is either
 *   { group, side?, minTier }                                  — this mod at this tier or better
 *   { kOf: 2, options: [{ group, side?, minTier }, ...] }      — any k of these
 * Every pick must be satisfied.
 */
export function hasMod(item: readonly PoolMod[], t: SimplePick): boolean {
  return item.some((m) => m.group === t.group && (!t.side || m.side === t.side) && m.tier != null && m.tier <= t.minTier);
}

export function meetsTarget(item: readonly PoolMod[], target: Target): boolean {
  return target.every((t) => (isKOf(t) ? t.options.filter((o) => hasMod(item, o)).length >= t.kOf : hasMod(item, t)));
}

/** Human-readable target, e.g. "IncreasedLife ≥ T2 AND 2 of {FireResistance≥T2, ColdResistance≥T2}". */
export function describeTarget(target: Target): string {
  return target
    .map((t) => (isKOf(t) ? `${t.kOf} of {${t.options.map((o) => `${o.group}≥T${o.minTier}`).join(", ")}}` : `${t.group} ≥ T${t.minTier}`))
    .join(" AND ");
}

export interface EstimateOptions {
  poolInfo: PoolInfo;
  target: Target;
  /** RePoE mod ids to force onto every roll (essence mods). Must be in poolInfo.pool. */
  forcedIds?: readonly string[];
  /** Number of Monte Carlo rolls. */
  sims: number;
  /** RNG seed. The POC and the parity scenarios use 7. */
  seed?: number;
  /** Chaos per attempt. When omitted the cost fields are undefined. */
  costPerAttempt?: number;
}

export interface Estimate {
  /** Per-attempt success probability, hits / sims. */
  p: number;
  hits: number;
  sims: number;
  /** 1.96 * sqrt(p(1-p)/sims): normal approximation, absolute (not relative). */
  ci95: number;
  /** 1 / p, or Infinity when p = 0. */
  expAttempts: number;
  /** Geometric: ceil(log(0.1) / log(1-p)), or Infinity when p = 0. */
  p90Attempts: number;
  costPerAttempt: number | undefined;
  /** expAttempts x costPerAttempt; undefined when no cost was given. */
  expCost: number | undefined;
  /** p90Attempts x costPerAttempt; undefined when no cost was given. */
  p90Cost: number | undefined;
  /** "<text> (T<tier>)" per forced mod, in forcedIds order. */
  forced: string[];
}

/**
 * Monte Carlo estimate of the per-attempt odds of `target` when rerolling from scratch with the
 * given forced mods. Deterministic for a given seed: the parity suite relies on this.
 *
 * Two conscious departures from the POC's estimate(), neither affecting p or hits: cost fields are
 * undefined (not NaN) when no cost is given, and there is no `label` (the caller names methods).
 * One POC quirk is kept: at p = 1, p90Attempts is ceil(log(0.1) / log(0)) = -0 rather than 1.
 * Treat p = 1 downstream; do not change it here before parity against Craft of Exile passes.
 */
export function estimate({ poolInfo, target, forcedIds = [], sims, seed = 7, costPerAttempt }: EstimateOptions): Estimate {
  const rng = makeRng(seed);
  const forced = forcedIds.map((id) => poolModById(poolInfo, id));
  let hits = 0;
  for (let i = 0; i < sims; i++) if (meetsTarget(rollRare(poolInfo, rng, forced), target)) hits++;
  const p = hits / sims;
  const ci95 = 1.96 * Math.sqrt((p * (1 - p)) / sims); // normal approx, absolute
  const expAttempts = p > 0 ? 1 / p : Infinity;
  const p90Attempts = p > 0 ? Math.ceil(Math.log(0.1) / Math.log(1 - p)) : Infinity; // geometric
  return {
    p,
    hits,
    sims,
    ci95,
    expAttempts,
    p90Attempts,
    costPerAttempt,
    expCost: costPerAttempt == null ? undefined : expAttempts * costPerAttempt,
    p90Cost: costPerAttempt == null ? undefined : p90Attempts * costPerAttempt,
    forced: forced.map((m) => `${m.text} (T${m.tier})`),
  };
}
