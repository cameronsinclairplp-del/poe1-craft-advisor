// Roll engine unit tests. Everything here runs on a small hand-written PoolFile so the suite
// needs no data files (public/data is generated separately). Parity with poc/results.json is
// the parity suite's job; this file checks the mechanics rollRare must honour and the maths in
// estimate().

import { describe, expect, it } from "vitest";
import { buildPool, poolModById } from "../../src/engine/pool.ts";
import { makeRng, type Rng } from "../../src/engine/rng.ts";
import {
  AFFIX_COUNT_WEIGHTS,
  describeTarget,
  estimate,
  hasMod,
  meetsTarget,
  pickAffixCount,
  rollRare,
} from "../../src/engine/roll.ts";
import type { BaseRecord, ModRecord, PoolFile, PoolMod, Target } from "../../src/engine/types.ts";

// ---------------------------------------------------------------------------
// Synthetic PoolFile: one base, 9 mods. Weights and levels are invented for the test; they are
// not game data and must not be read as such.
// ---------------------------------------------------------------------------

const BASE: BaseRecord = {
  id: "Metadata/Items/Armours/BodyArmours/TestPlate",
  name: "Test Plate",
  item_class: "Body Armour",
  tags: ["default", "body_armour", "armour"],
  drop_level: 1,
  implicits: [],
  requirements: { level: 1, strength: 0, dexterity: 0, intelligence: 0 },
  tag_set: 0,
};

function mod(o: Pick<ModRecord, "id" | "side" | "groups" | "required_level"> & Partial<ModRecord>): ModRecord {
  return {
    name: o.id,
    text: o.id,
    type: o.groups[0] ?? o.id,
    is_essence_only: false,
    spawn_weights: [{ tag: "default", weight: 1000 }],
    generation_weights: [],
    adds_tags: [],
    implicit_tags: [],
    stats: [],
    ...o,
  };
}

// In "mods.json key order": the roll engine draws in this order, so the tests below that walk
// the pool by hand depend on it.
const MODS: ModRecord[] = [
  // 0: life T2 (L81). Listed before T1 so buildPool's level sort is exercised.
  mod({ id: "IncreasedLife7", name: "Rotund", text: "+(160-174) to maximum Life", side: "prefix", groups: ["IncreasedLife"], required_level: 81, spawn_weights: [{ tag: "default", weight: 1000 }], stats: [{ id: "base_maximum_life", min: 160, max: 174 }] }),
  // 1: life T1 (L86)
  mod({ id: "IncreasedLife8", name: "Virile", text: "+(175-189) to maximum Life", side: "prefix", groups: ["IncreasedLife"], required_level: 86, spawn_weights: [{ tag: "default", weight: 500 }], stats: [{ id: "base_maximum_life", min: 175, max: 189 }] }),
  // 2: armour %. Weight sits on "armour", not "default", and the ORDERED list puts a zero on
  //    "default" after it: first match wins, so the base resolves to 800.
  mod({ id: "LocalIncreasedPhysicalDamageReductionRating5", name: "Lizard's", text: "(50-60)% increased Armour", side: "prefix", groups: ["DefencesPercent"], required_level: 60, spawn_weights: [{ tag: "armour", weight: 800 }, { tag: "default", weight: 0 }], stats: [{ id: "local_physical_damage_reduction_rating_+%", min: 50, max: 60 }] }),
  // 3: an attack mod that adds the has_attack_mod tag once placed
  mod({ id: "AddedPhysicalDamageTest", name: "Glinting", text: "Adds (1-2) to (3-4) Physical Damage", side: "prefix", groups: ["PhysicalDamage"], required_level: 1, spawn_weights: [{ tag: "default", weight: 300 }], adds_tags: ["has_attack_mod"] }),
  // 4-6: three suffix groups
  mod({ id: "FireResistance7", name: "of the Magma", text: "+(46-48)% to Fire Resistance", side: "suffix", groups: ["FireResistance"], required_level: 84, spawn_weights: [{ tag: "default", weight: 500 }], stats: [{ id: "base_fire_damage_resistance_%", min: 46, max: 48 }] }),
  mod({ id: "ColdResistance7", name: "of the Ice", text: "+(46-48)% to Cold Resistance", side: "suffix", groups: ["ColdResistance"], required_level: 84, spawn_weights: [{ tag: "default", weight: 500 }], stats: [{ id: "base_cold_damage_resistance_%", min: 46, max: 48 }] }),
  mod({ id: "Strength9", name: "of the Titan", text: "+(51-55) to Strength", side: "suffix", groups: ["Strength"], required_level: 82, spawn_weights: [{ tag: "default", weight: 400 }], stats: [{ id: "additional_strength", min: 51, max: 55 }] }),
  // 7: only spawn weight is on has_attack_mod, which the base does not carry
  mod({ id: "TagGatedSuffix", name: "of Testing", text: "Tag-gated test suffix", side: "suffix", groups: ["TagGated"], required_level: 1, spawn_weights: [{ tag: "has_attack_mod", weight: 1000 }] }),
  // 8: essence-only life, value between T2 and T1 -> value-based tier 2
  mod({ id: "IncreasedLifeEssence", name: "Essences", text: "+(160-174) to maximum Life", side: "prefix", groups: ["IncreasedLife"], required_level: 1, is_essence_only: true, spawn_weights: [{ tag: "default", weight: 0 }], stats: [{ id: "base_maximum_life", min: 160, max: 174 }] }),
];

const FILE: PoolFile = {
  schema: 2,
  generated: "2026-09-05T00:00:00.000Z",
  source: { repoe: "synthetic", mods_last_modified: null, data_last_modified: null },
  item_class: "Body Armour",
  influence_tags: [],
  bases: [BASE],
  mods: MODS,
  tag_sets: [
    {
      tags: BASE.tags,
      base_ids: [BASE.id],
      weights: [1000, 500, 800, 300, 500, 500, 400, 0, 0],
      tiers: {
        "IncreasedLife|prefix": [1, 0],
        "DefencesPercent|prefix": [2],
        "PhysicalDamage|prefix": [3],
        "FireResistance|suffix": [4],
        "ColdResistance|suffix": [5],
        "Strength|suffix": [6],
      },
    },
  ],
  essences: [
    { id: "Metadata/Items/Currency/Essence/TestGreed7", name: "Test Essence of Greed", level: 7, tier: 7, is_corruption_only: false, item_level_restriction: null, spawn_level_min: 1, mod_id: "IncreasedLifeEssence" },
  ],
  bench: [],
  fossils: [],
  implicit_mods: {},
  crafted_mods: [],
  unveiled_mods: [],
  influence_mods: [],
  veiled_mods: [],
};

const POOL_86 = buildPool(FILE, BASE, 86);
const POOL_1 = buildPool(FILE, BASE, 1);
const ESSENCE_LIFE = poolModById(POOL_86, "IncreasedLifeEssence");

/** rng that replays a fixed script and refuses to run past it. */
const scripted = (values: readonly number[]): Rng => {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error(`scripted rng exhausted after ${values.length} draws`);
    return v;
  };
};

/** Wrap an rng and count its calls. */
const counting = (inner: Rng): { rng: Rng; calls: () => number } => {
  let n = 0;
  return { rng: () => (n++, inner()), calls: () => n };
};

const ids = (item: readonly PoolMod[]): string[] => item.map((m) => m.id);

// ---------------------------------------------------------------------------

describe("synthetic pool sanity (buildPool over the fixture)", () => {
  it("has 8 mods at ilvl 86: everything but the tag-gated suffix", () => {
    expect(ids(POOL_86.pool)).toEqual([
      "IncreasedLife7",
      "IncreasedLife8",
      "LocalIncreasedPhysicalDamageReductionRating5",
      "AddedPhysicalDamageTest",
      "FireResistance7",
      "ColdResistance7",
      "Strength9",
      "IncreasedLifeEssence",
    ]);
  });

  it("tiers: life T1 = L86, T2 = L81, essence life = T2 by value; ordered spawn weights resolve first-match", () => {
    expect(poolModById(POOL_86, "IncreasedLife8").tier).toBe(1);
    expect(poolModById(POOL_86, "IncreasedLife7").tier).toBe(2);
    expect(ESSENCE_LIFE.tier).toBe(2);
    expect(ESSENCE_LIFE.weight).toBe(0);
    expect(poolModById(POOL_86, "LocalIncreasedPhysicalDamageReductionRating5").weight).toBe(800);
  });

  it("at ilvl 1 only the L1 attack prefix and the essence-only mod remain", () => {
    expect(ids(POOL_1.pool)).toEqual(["AddedPhysicalDamageTest", "IncreasedLifeEssence"]);
  });
});

describe("AFFIX_COUNT_WEIGHTS / pickAffixCount", () => {
  it("is the ordered 8:3:1 split for 4/5/6", () => {
    expect(AFFIX_COUNT_WEIGHTS).toEqual([
      [4, 8],
      [5, 3],
      [6, 1],
    ]);
  });

  it("makes exactly one rng call and walks the pairs in order with (r -= w) < 0", () => {
    // total = 12. r = v * 12: 0.5 -> 6 -> 4; 0.75 -> 9 -> 5; 0.95 -> 11.4 -> 6.
    for (const [v, want] of [
      [0, 4],
      [0.5, 4],
      [0.75, 5],
      [0.95, 6],
    ] as const) {
      const { rng, calls } = counting(scripted([v]));
      expect(pickAffixCount(rng)).toBe(want);
      expect(calls()).toBe(1);
    }
  });

  it("proportions over 120,000 draws with makeRng(1) are within 0.01 of 8/12, 3/12, 1/12 and only 4/5/6 occur", () => {
    const rng = makeRng(1);
    const counts = new Map<number, number>();
    const N = 120_000;
    for (let i = 0; i < N; i++) {
      const n = pickAffixCount(rng);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([4, 5, 6]);
    expect(Math.abs((counts.get(4) ?? 0) / N - 8 / 12)).toBeLessThan(0.01);
    expect(Math.abs((counts.get(5) ?? 0) / N - 3 / 12)).toBeLessThan(0.01);
    expect(Math.abs((counts.get(6) ?? 0) / N - 1 / 12)).toBeLessThan(0.01);
  });
});

describe("rollRare", () => {
  const ROLLS = 3000;

  it("never repeats a group, never exceeds 3 per side, and returns 4 to 6 mods when the pool can supply them", () => {
    const rng = makeRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < ROLLS; i++) {
      const item = rollRare(POOL_86, rng);
      seen.add(item.length);
      expect(item.length).toBeGreaterThanOrEqual(4);
      expect(item.length).toBeLessThanOrEqual(6);
      const groups = item.map((m) => m.group);
      expect(new Set(groups).size).toBe(groups.length);
      expect(item.filter((m) => m.side === "prefix").length).toBeLessThanOrEqual(3);
      expect(item.filter((m) => m.side === "suffix").length).toBeLessThanOrEqual(3);
    }
    expect([...seen].sort()).toEqual([4, 5, 6]);
  });

  it("returns fewer mods only when the pool runs dry, and stops calling rng when it does", () => {
    const { rng, calls } = counting(makeRng(3));
    const item = rollRare(POOL_1, rng);
    expect(ids(item)).toEqual(["AddedPhysicalDamageTest"]);
    // one call for n, one for the single draw; then no eligible mods -> break, no further calls
    expect(calls()).toBe(2);
  });

  it("makes one rng call for n plus one per drawn mod", () => {
    // With integer weights and rng() = k / 2^32 the walk always lands, so calls = 1 + drawn.
    const { rng, calls } = counting(makeRng(8));
    for (let i = 0; i < 200; i++) {
      const before = calls();
      const item = rollRare(POOL_86, rng);
      expect(calls() - before).toBe(1 + item.length);
    }
  });

  it("places forced mods first and counts them inside n", () => {
    // Script: 0 -> n = 4. Then three draws walk the pool in order:
    //   eligible [armour 800, phys 300, fire 500, cold 500, str 400] total 2500; 0 -> armour
    //   eligible [phys 300, fire 500, cold 500, str 400] total 1700;             0 -> phys
    //   prefixes full: eligible [fire 500, cold 500, str 400] total 1400; 0.99 -> r = 1386 -> str
    const { rng, calls } = counting(scripted([0, 0, 0, 0.99]));
    const item = rollRare(POOL_86, rng, [ESSENCE_LIFE]);
    expect(ids(item)).toEqual(["IncreasedLifeEssence", "LocalIncreasedPhysicalDamageReductionRating5", "AddedPhysicalDamageTest", "Strength9"]);
    expect(item.length).toBe(4); // forced mod occupies one of the n = 4 slots
    expect(calls()).toBe(4); // 1 for n + 3 draws
  });

  it("a forced mod blocks its group for the random draws", () => {
    const rng = makeRng(5);
    for (let i = 0; i < ROLLS; i++) {
      const item = rollRare(POOL_86, rng, [ESSENCE_LIFE]);
      expect(item[0]).toBe(ESSENCE_LIFE);
      expect(item.filter((m) => m.group === "IncreasedLife")).toHaveLength(1);
      expect(item.length).toBeGreaterThanOrEqual(4);
      expect(item.length).toBeLessThanOrEqual(6);
    }
  });

  it("the 3-per-side cap binds: with three forced prefixes only suffixes are drawn", () => {
    // Forced mods are not checked against the pool, so hand-made prefixes fill the prefix side.
    const fakePrefix = (group: string): PoolMod => ({ ...ESSENCE_LIFE, id: `forced-${group}`, group, essenceOnly: false, tier: 1 });
    const forced = [fakePrefix("ForcedA"), fakePrefix("ForcedB"), fakePrefix("ForcedC")];
    const rng = makeRng(9);
    for (let i = 0; i < ROLLS; i++) {
      const item = rollRare(POOL_86, rng, forced);
      expect(item.slice(0, 3)).toEqual(forced);
      for (const m of item.slice(3)) expect(m.side).toBe("suffix");
      expect(item.length).toBeLessThanOrEqual(6);
    }
  });

  it("never draws essence-only mods unless they are forced", () => {
    const rng = makeRng(11);
    for (let i = 0; i < ROLLS; i++) {
      expect(rollRare(POOL_86, rng).some((m) => m.essenceOnly)).toBe(false);
      expect(rollRare(POOL_1, rng).some((m) => m.essenceOnly)).toBe(false);
    }
  });

  it("same seed gives identical sequences of items; a different seed does not", () => {
    const run = (seed: number): string[][] => {
      const rng = makeRng(seed);
      return Array.from({ length: 200 }, () => ids(rollRare(POOL_86, rng)));
    };
    expect(run(99)).toEqual(run(99));
    expect(run(99)).not.toEqual(run(100));
  });

  it("never draws the tag-gated mod, even after a mod that adds its tag is placed", () => {
    // VERIFY (limitation carried from the POC): weights are resolved once at buildPool time
    // against the base tags. TagGatedSuffix only has weight on has_attack_mod, so it is left out
    // of the pool entirely, and AddedPhysicalDamageTest adding that tag mid-roll cannot bring it
    // in. RePoE says adds_tags should change the weights of later draws (types.ts ModRecord);
    // the POC and this port do not model that yet. When they do, this test must change.
    expect(POOL_86.pool.some((m) => m.id === "TagGatedSuffix")).toBe(false);
    expect(poolModById(POOL_86, "AddedPhysicalDamageTest").addsTags).toEqual(["has_attack_mod"]);
    const rng = makeRng(13);
    let sawAttackMod = false;
    for (let i = 0; i < ROLLS; i++) {
      const item = rollRare(POOL_86, rng);
      if (item.some((m) => m.id === "AddedPhysicalDamageTest")) sawAttackMod = true;
      expect(item.some((m) => m.id === "TagGatedSuffix")).toBe(false);
    }
    expect(sawAttackMod).toBe(true);
  });
});

describe("hasMod / meetsTarget / describeTarget", () => {
  const lifeT1 = poolModById(POOL_86, "IncreasedLife8");
  const lifeT2 = poolModById(POOL_86, "IncreasedLife7");
  const fire = poolModById(POOL_86, "FireResistance7");
  const str = poolModById(POOL_86, "Strength9");

  it("hasMod respects group, minTier (tier <= minTier) and side", () => {
    expect(hasMod([lifeT2], { group: "IncreasedLife", minTier: 2 })).toBe(true);
    expect(hasMod([lifeT2], { group: "IncreasedLife", minTier: 1 })).toBe(false);
    expect(hasMod([lifeT1], { group: "IncreasedLife", minTier: 1 })).toBe(true);
    expect(hasMod([lifeT1], { group: "IncreasedLife", minTier: 3 })).toBe(true);
    expect(hasMod([lifeT2], { group: "IncreasedLife", side: "prefix", minTier: 2 })).toBe(true);
    expect(hasMod([lifeT2], { group: "IncreasedLife", side: "suffix", minTier: 2 })).toBe(false);
    expect(hasMod([lifeT2], { group: "FireResistance", minTier: 9 })).toBe(false);
    expect(hasMod([], { group: "IncreasedLife", minTier: 9 })).toBe(false);
  });

  it("hasMod never matches a mod with a null tier", () => {
    const untiered: PoolMod = { ...lifeT2, tier: null };
    expect(hasMod([untiered], { group: "IncreasedLife", minTier: 99 })).toBe(false);
    expect(hasMod([untiered, lifeT2], { group: "IncreasedLife", minTier: 2 })).toBe(true);
  });

  it("meetsTarget requires every pick; kOf counts satisfied options", () => {
    const item = [lifeT2, fire, str];
    const twoRes: Target = [{ kOf: 2, options: [{ group: "FireResistance", side: "suffix", minTier: 2 }, { group: "ColdResistance", side: "suffix", minTier: 2 }, { group: "LightningResistance", side: "suffix", minTier: 2 }] }];
    expect(meetsTarget(item, [])).toBe(true);
    expect(meetsTarget(item, [{ group: "IncreasedLife", side: "prefix", minTier: 2 }])).toBe(true);
    expect(meetsTarget(item, [{ group: "IncreasedLife", side: "prefix", minTier: 1 }])).toBe(false);
    expect(meetsTarget(item, [{ group: "IncreasedLife", minTier: 2 }, { group: "FireResistance", minTier: 1 }])).toBe(true);
    expect(meetsTarget(item, [{ group: "IncreasedLife", minTier: 2 }, { group: "ColdResistance", minTier: 1 }])).toBe(false);
    expect(meetsTarget(item, twoRes)).toBe(false);
    expect(meetsTarget(item, [{ kOf: 1, options: [{ group: "FireResistance", minTier: 1 }, { group: "ColdResistance", minTier: 1 }] }])).toBe(true);
    expect(meetsTarget(item, [{ kOf: 2, options: [{ group: "FireResistance", minTier: 1 }, { group: "Strength", minTier: 1 }] }])).toBe(true);
    expect(meetsTarget(item, [{ kOf: 2, options: [{ group: "FireResistance", minTier: 1 }, { group: "Strength", minTier: 1 }] }, { group: "IncreasedLife", minTier: 1 }])).toBe(false);
    // kOf of 0 is trivially met, as in the POC (0 >= 0)
    expect(meetsTarget([], [{ kOf: 0, options: [] }])).toBe(true);
  });

  it("describeTarget formats simple and kOf picks like the POC", () => {
    expect(describeTarget([{ group: "IncreasedLife", side: "prefix", minTier: 2 }, { kOf: 2, options: [{ group: "FireResistance", minTier: 2 }, { group: "ColdResistance", minTier: 2 }] }])).toBe(
      "IncreasedLife ≥ T2 AND 2 of {FireResistance≥T2, ColdResistance≥T2}",
    );
    expect(describeTarget([])).toBe("");
  });
});

describe("estimate", () => {
  const LIFE2: Target = [{ group: "IncreasedLife", side: "prefix", minTier: 2 }];

  it("reproduces a manual loop with makeRng(7) and reports p, ci95, expAttempts, p90Attempts", () => {
    const sims = 500;
    const rng = makeRng(7); // estimate's default seed
    let manual = 0;
    for (let i = 0; i < sims; i++) if (meetsTarget(rollRare(POOL_86, rng), LIFE2)) manual++;

    const r = estimate({ poolInfo: POOL_86, target: LIFE2, sims });
    expect(r.sims).toBe(sims);
    expect(r.hits).toBe(manual);
    expect(r.hits).toBeGreaterThan(0);
    expect(r.hits).toBeLessThan(sims);
    const p = manual / sims;
    expect(r.p).toBe(p);
    expect(r.ci95).toBe(1.96 * Math.sqrt((p * (1 - p)) / sims));
    expect(r.expAttempts).toBe(1 / p);
    expect(r.p90Attempts).toBe(Math.ceil(Math.log(0.1) / Math.log(1 - p)));
    expect(Number.isInteger(r.p90Attempts)).toBe(true);
    expect(r.costPerAttempt).toBeUndefined();
    expect(r.expCost).toBeUndefined();
    expect(r.p90Cost).toBeUndefined();
    expect(r.forced).toEqual([]);
  });

  it("is deterministic for a seed and changes with it", () => {
    const a = estimate({ poolInfo: POOL_86, target: LIFE2, sims: 300, seed: 123 });
    const b = estimate({ poolInfo: POOL_86, target: LIFE2, sims: 300, seed: 123 });
    const c = estimate({ poolInfo: POOL_86, target: LIFE2, sims: 300, seed: 124 });
    expect(a).toEqual(b);
    expect(a.hits).not.toBe(c.hits);
  });

  it("multiplies attempts by costPerAttempt when a cost is given", () => {
    const r = estimate({ poolInfo: POOL_86, target: LIFE2, sims: 400, costPerAttempt: 2.5 });
    expect(r.costPerAttempt).toBe(2.5);
    expect(r.expCost).toBe(r.expAttempts * 2.5);
    expect(r.p90Cost).toBe(r.p90Attempts * 2.5);
  });

  it("p = 0: ci95 0, Infinity attempts and costs", () => {
    const r = estimate({ poolInfo: POOL_86, target: [{ group: "DoesNotExist", minTier: 1 }], sims: 50, costPerAttempt: 3 });
    expect(r.hits).toBe(0);
    expect(r.p).toBe(0);
    expect(r.ci95).toBe(0);
    expect(r.expAttempts).toBe(Infinity);
    expect(r.p90Attempts).toBe(Infinity);
    expect(r.expCost).toBe(Infinity);
    expect(r.p90Cost).toBe(Infinity);
  });

  it("forced mods are placed on every roll and described as '<text> (T<tier>)'", () => {
    const r = estimate({ poolInfo: POOL_86, target: LIFE2, forcedIds: ["IncreasedLifeEssence"], sims: 200, costPerAttempt: 4 });
    expect(r.forced).toEqual(["+(160-174) to maximum Life (T2)"]);
    // The forced essence life is T2, so the target is met on every roll.
    expect(r.hits).toBe(200);
    expect(r.p).toBe(1);
    expect(r.ci95).toBe(0);
    expect(r.expAttempts).toBe(1);
    expect(r.expCost).toBe(4);
    // POC quirk kept for parity: at p = 1 the geometric formula gives ceil(log(0.1) / -Infinity) = -0.
    expect(r.p90Attempts === 0).toBe(true);
  });

  it("throws for a forced id that is not in the pool", () => {
    expect(() => estimate({ poolInfo: POOL_86, target: LIFE2, forcedIds: ["NotAMod"], sims: 1 })).toThrow("forced mod NotAMod not in pool");
  });
});
