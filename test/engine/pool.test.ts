// Data-backed pool tests over the generated public/data files. roll.test.ts covers the mechanics
// on a synthetic fixture; this file checks that buildPool over the real RePoE-derived data gives
// the numbers BRIEF.md §7.1 and the parity scenarios rely on, and that the pre-resolved tag sets
// in every file agree with what the engine derives at runtime.
//
// Expected ids, levels and ranges below were read off the built data (public/data, RePoE
// mods.json Last-Modified 04/09/2026) and cross-checked against BRIEF.md §7.1, which in turn
// matches poedb. They are data facts, not invented numbers.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { buildPool, essenceForBase, findBase, poolModById } from "../../src/engine/pool.ts";
import type { ModRecord, PoolFile, PoolInfo, PoolMod } from "../../src/engine/types.ts";
import { ROOT, loadPoolFileByClass, loadPoolFileFor } from "../helpers/data.ts";

/** Checked index (noUncheckedIndexedAccess): throws instead of returning undefined. */
function at<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new Error(`index ${i} out of range (length ${list.length})`);
  return value;
}

/** Rollable mods of one (group, side) in the pool, best tier first. */
function ladder(poolInfo: PoolInfo, group: string, side: "prefix" | "suffix"): PoolMod[] {
  return poolInfo.pool
    .filter((p) => p.group === group && p.side === side && !p.essenceOnly)
    .sort((a, b) => (a.tier ?? Number.MAX_SAFE_INTEGER) - (b.tier ?? Number.MAX_SAFE_INTEGER));
}

/** The ModRecord behind a pool mod, for stat ranges. */
function record(file: PoolFile, p: PoolMod): ModRecord {
  return at(file.mods, p.index);
}

const bodyArmour = loadPoolFileFor("Astral Plate");
const astralPlate = findBase(bodyArmour, "Astral Plate");
const astral86 = buildPool(bodyArmour, astralPlate, 86);

// ---------------------------------------------------------------------------

describe("Astral Plate ilvl 86 (BRIEF.md §7.1)", () => {
  it("is in the Body Armour file and is the only base with that name", () => {
    expect(bodyArmour.item_class).toBe("Body Armour");
    expect(bodyArmour.bases.filter((b) => b.name === "Astral Plate")).toHaveLength(1);
    expect(astralPlate.id).toBe("Metadata/Items/Armours/BodyArmours/BodyStr15");
  });

  it("has 109 rollable mods; everything else in the pool is essence-only with weight 0", () => {
    const rollable = astral86.pool.filter((p) => !p.essenceOnly);
    expect(rollable).toHaveLength(109);
    for (const p of rollable) expect(p.weight).toBeGreaterThan(0);
    for (const p of astral86.pool.filter((p) => p.essenceOnly)) expect(p.weight).toBe(0);
  });

  it("keeps the pool in PoolFile.mods order (the roll engine's draw order)", () => {
    for (let i = 1; i < astral86.pool.length; i++) {
      expect(at(astral86.pool, i).index).toBeGreaterThan(at(astral86.pool, i - 1).index);
    }
    for (const p of astral86.pool) expect(record(bodyArmour, p).id).toBe(p.id);
  });

  it("life prefix ladder: T1 = IncreasedLife12 L86 +(175-189), T2 = IncreasedLife11 L81 +(160-174)", () => {
    const life = ladder(astral86, "IncreasedLife", "prefix");
    const t1 = at(life, 0);
    const t2 = at(life, 1);
    expect(t1.tier).toBe(1);
    expect(t1.id).toBe("IncreasedLife12");
    expect(t1.level).toBe(86);
    expect(t1.text).toBe("+(175-189) to maximum Life");
    expect(record(bodyArmour, t1).stats[0]).toMatchObject({ min: 175, max: 189 });
    expect(t2.tier).toBe(2);
    expect(t2.id).toBe("IncreasedLife11");
    expect(t2.level).toBe(81);
    expect(t2.text).toBe("+(160-174) to maximum Life");
    expect(record(bodyArmour, t2).stats[0]).toMatchObject({ min: 160, max: 174 });
    // Tiers are dense: 1..n with no gaps.
    expect(life.map((p) => p.tier)).toEqual(life.map((_, i) => i + 1));
  });

  it("fire resistance suffix ladder: T1 = FireResist8 L84 +(46-48)%", () => {
    const fire = ladder(astral86, "FireResistance", "suffix");
    const t1 = at(fire, 0);
    expect(t1.tier).toBe(1);
    expect(t1.id).toBe("FireResist8");
    expect(t1.level).toBe(84);
    expect(t1.text).toBe("+(46-48)% to Fire Resistance");
    expect(record(bodyArmour, t1).stats[0]).toMatchObject({ min: 46, max: 48 });
    expect(at(fire, 1).text).toBe("+(42-45)% to Fire Resistance"); // the scenarios' "+42% or better" T2
  });
});

describe("tiers are relative to what can roll at the item level (CLAUDE.md convention)", () => {
  // Craft of Exile and poedb number tiers absolutely (T1 life is always +175-189). This project
  // ranks over the mods that can roll on this base at this ilvl, so at ilvl 80 the best life mod
  // that can roll becomes T1. The expected id is derived from the file's own ladder, not typed in.
  const ILVL = 80;

  it(`at ilvl ${ILVL} Astral Plate's life T1 is the highest life mod with required_level <= ${ILVL}`, () => {
    const tagSet = at(bodyArmour.tag_sets, astralPlate.tag_set);
    const fullLadder = tagSet.tiers["IncreasedLife|prefix"];
    expect(fullLadder).toBeDefined();
    const expectedIndex = (fullLadder ?? []).find((i) => at(bodyArmour.mods, i).required_level <= ILVL);
    expect(expectedIndex).toBeDefined();
    const expected = at(bodyArmour.mods, expectedIndex ?? -1);

    const pool80 = buildPool(bodyArmour, astralPlate, ILVL);
    const life80 = ladder(pool80, "IncreasedLife", "prefix");
    const t1 = at(life80, 0);
    expect(t1.tier).toBe(1);
    expect(t1.id).toBe(expected.id);
    expect(t1.level).toBe(expected.required_level);
    expect(t1.level).toBeLessThanOrEqual(ILVL);
    // Concretely, on today's data that is IncreasedLife10 (L73, +145-159), two rungs below the
    // ilvl 86 T1; the L86 and L81 mods cannot roll at ilvl 80 and are not in the pool at all.
    expect(t1.id).not.toBe("IncreasedLife12");
    expect(pool80.pool.some((p) => p.id === "IncreasedLife12")).toBe(false);
    expect(pool80.pool.some((p) => p.id === "IncreasedLife11")).toBe(false);
    expect(life80.length).toBe(ladder(astral86, "IncreasedLife", "prefix").length - 2);
  });
});

describe("Titan Greaves ilvl 86 (Boots)", () => {
  const boots = loadPoolFileFor("Titan Greaves");
  const titan = findBase(boots, "Titan Greaves");
  const titan86 = buildPool(boots, titan, 86);

  it("movement speed prefix ladder: T1 is 35%, T2 is 30%", () => {
    const ms = ladder(titan86, "MovementVelocity", "prefix");
    expect(at(ms, 0).tier).toBe(1);
    expect(at(ms, 0).text).toBe("35% increased Movement Speed");
    expect(at(ms, 1).tier).toBe(2);
    expect(at(ms, 1).text).toBe("30% increased Movement Speed");
  });

  it("Deafening Essence of Zeal forces MovementVelocityEssence7: essence-only, 32%, value-based tier 2", () => {
    const id = essenceForBase(boots, "Deafening Essence of Zeal", titan);
    expect(id).toBe("MovementVelocityEssence7");
    const m = poolModById(titan86, id);
    expect(m.essenceOnly).toBe(true);
    expect(m.weight).toBe(0);
    expect(m.side).toBe("prefix");
    expect(m.group).toBe("MovementVelocity");
    expect(m.text).toBe("32% increased Movement Speed");
    expect(m.statMax).toBe(32);
    // 32% sits between the rollable T1 (35%) and T2 (30%): 1 + one rollable tier that beats it. // VERIFY (POC rule)
    expect(m.tier).toBe(2);
  });
});

describe("Vaal Axe ilvl 86 (Two Hand Axe)", () => {
  const axes = loadPoolFileFor("Vaal Axe");
  const vaalAxe = findBase(axes, "Vaal Axe");
  const vaal86 = buildPool(axes, vaalAxe, 86);

  it("Deafening Essence of Zeal forces LocalIncreasedAttackSpeedEssence7: a suffix that adds has_attack_mod, tier 1", () => {
    const id = essenceForBase(axes, "Deafening Essence of Zeal", vaalAxe);
    expect(id).toBe("LocalIncreasedAttackSpeedEssence7");
    const m = poolModById(vaal86, id);
    expect(m.side).toBe("suffix");
    expect(m.essenceOnly).toBe(true);
    expect(m.addsTags).toContain("has_attack_mod");
    expect(m.text).toBe("(28-30)% increased Attack Speed");
    // Its 30% max beats every rollable attack speed suffix on the base, so the value-based rule gives T1.
    const best = ladder(vaal86, m.group, "suffix")[0];
    expect(best).toBeDefined();
    expect(best?.statMax ?? Infinity).toBeLessThan(30);
    expect(m.tier).toBe(1);
  });

  it("the pure physical damage prefix the scenarios target is a distinct group from the hybrid with accuracy", () => {
    const pure = ladder(vaal86, "LocalPhysicalDamagePercent", "prefix");
    expect(pure.length).toBeGreaterThanOrEqual(2);
    for (const p of pure) expect(p.text).toMatch(/^\(\d+-\d+\)% increased Physical Damage$/);
    expect(vaal86.pool.some((p) => p.side === "prefix" && p.group !== "LocalPhysicalDamagePercent" && p.text.includes("increased Physical Damage"))).toBe(true);
  });
});

describe("essenceForBase", () => {
  it("Deafening Essence of Greed on Body Armour -> IncreasedLife11, a regular (rollable) mod at tier 2", () => {
    const id = essenceForBase(bodyArmour, "Deafening Essence of Greed", astralPlate);
    expect(id).toBe("IncreasedLife11");
    const m = poolModById(astral86, id);
    expect(m.essenceOnly).toBe(false);
    expect(m.weight).toBeGreaterThan(0);
    expect(m.tier).toBe(2);
    expect(m.text).toBe("+(160-174) to maximum Life");
  });

  it("Deafening Essence of Anger on Body Armour -> FireResist8, the rollable T1", () => {
    const m = poolModById(astral86, essenceForBase(bodyArmour, "Deafening Essence of Anger", astralPlate));
    expect(m.id).toBe("FireResist8");
    expect(m.essenceOnly).toBe(false);
    expect(m.tier).toBe(1);
  });

  it("throws for Remnant of Corruption, which forces no mod on any class (essences.json mods are all null)", () => {
    expect(bodyArmour.essences.some((e) => e.name === "Remnant of Corruption")).toBe(false);
    expect(() => essenceForBase(bodyArmour, "Remnant of Corruption", astralPlate)).toThrow(/cannot be used on Body Armour/);
  });

  it("throws for a class RePoE essences.json never lists (Warstaff has no essence mods at all)", () => {
    // essences.json keys mods by 22 item classes; Warstaff, Rune Dagger and FishingRod are not among
    // them, so their files carry zero essences and every essence must be rejected. (In the game
    // essences do reforge warstaves and rune daggers; see the VERIFY note on PoolFile.essences.)
    const warstaves = loadPoolFileByClass("Warstaff");
    expect(warstaves.essences).toHaveLength(0);
    const base = at(warstaves.bases, 0);
    expect(() => essenceForBase(warstaves, "Deafening Essence of Greed", base)).toThrow(/cannot be used on Warstaff/);
  });

  it("throws for a name that is not an essence", () => {
    expect(() => essenceForBase(bodyArmour, "Deafening Essence of Nothing", astralPlate)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_sets consistency: the pre-resolved weights and tier ladders in the file must be exactly what
// buildPool derives at runtime (build-data asserts this for every base in every class file; this re-checks four
// files from the test side so a hand-edited or stale data file cannot slip past the suite).
// ---------------------------------------------------------------------------

/** Item level at which every mod is in: no item-domain mod has required_level > 95 today. */
const CHECK_ILVL = 100;

function tierKey(m: ModRecord): string {
  return `${m.groups[0] ?? m.type}|${m.side}`;
}

/** Mismatches between a base's tag set and buildPool at CHECK_ILVL. Empty = consistent. */
function tagSetProblems(file: PoolFile, baseIndex: number): string[] {
  const base = at(file.bases, baseIndex);
  const where = `${file.item_class} / ${base.name} (${base.id})`;
  const problems: string[] = [];
  const tagSet = file.tag_sets[base.tag_set];
  if (!tagSet) return [`${where}: tag_set ${base.tag_set} does not exist`];
  if (!tagSet.base_ids.includes(base.id)) problems.push(`${where}: tag set ${base.tag_set} does not list this base`);
  if (JSON.stringify(tagSet.tags) !== JSON.stringify(base.tags)) problems.push(`${where}: tag set tags differ from the base's tags`);
  if (tagSet.weights.length !== file.mods.length) return [...problems, `${where}: ${tagSet.weights.length} weights for ${file.mods.length} mods`];

  const { pool } = buildPool(file, base, CHECK_ILVL);
  const rollable = new Set<number>();
  for (const p of pool) {
    if (p.essenceOnly) continue;
    if (tagSet.weights[p.index] !== p.weight) problems.push(`${where}: ${p.id} runtime weight ${p.weight} != tag-set weight ${tagSet.weights[p.index]}`);
    rollable.add(p.index);
  }
  tagSet.weights.forEach((w, i) => {
    if (w > 0 !== rollable.has(i)) problems.push(`${where}: ${at(file.mods, i).id} tag-set weight ${w} but ${rollable.has(i) ? "" : "not "}rollable`);
  });

  const ladderTier = new Map<number, number>();
  for (const [key, indices] of Object.entries(tagSet.tiers)) {
    let previousLevel = Number.POSITIVE_INFINITY;
    indices.forEach((i, rank) => {
      const m = at(file.mods, i);
      if (tierKey(m) !== key) problems.push(`${where}: ${m.id} sits in ladder ${key} but belongs to ${tierKey(m)}`);
      if (!rollable.has(i)) problems.push(`${where}: ${m.id} is in ladder ${key} but is not rollable`);
      if (m.required_level > previousLevel) problems.push(`${where}: ladder ${key} not sorted by required_level desc at ${m.id}`);
      previousLevel = m.required_level;
      ladderTier.set(i, rank + 1); // at CHECK_ILVL every entry is in, so tier = position + 1
    });
  }
  for (const p of pool) {
    if (p.essenceOnly) continue;
    if (ladderTier.get(p.index) !== p.tier) problems.push(`${where}: ${p.id} runtime tier ${p.tier} != ladder tier ${ladderTier.get(p.index) ?? "absent"}`);
  }
  if (ladderTier.size !== rollable.size) problems.push(`${where}: ladders cover ${ladderTier.size} mods, pool has ${rollable.size} rollable`);
  return problems;
}

describe(`tag_sets agree with buildPool at ilvl ${CHECK_ILVL} for every base`, () => {
  for (const itemClass of ["Body Armour", "Boots", "Two Hand Axe", "Ring"]) {
    it(`${itemClass}: weights, rollable set and tier per mod`, () => {
      const file = loadPoolFileByClass(itemClass);
      expect(file.item_class).toBe(itemClass);
      expect(file.bases.length).toBeGreaterThan(0);
      const problems = file.bases.flatMap((_, i) => tagSetProblems(file, i));
      expect(problems).toEqual([]);
      // Every tag set is used by at least one base and lists only bases of this file.
      const baseIds = new Set(file.bases.map((b) => b.id));
      for (const ts of file.tag_sets) {
        expect(ts.base_ids.length).toBeGreaterThan(0);
        for (const id of ts.base_ids) expect(baseIds.has(id)).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// PoolFile.mods order. The parity suite reproduces the POC bit for bit only if the pool is drawn
// in mods.json key order (types.ts). The raw download is gitignored, so this check runs only when
// .cache/repoe/mods.json is present.
// ---------------------------------------------------------------------------

const RAW_MODS = resolve(ROOT, ".cache", "repoe", "mods.json");

describe("PoolFile.mods order", () => {
  it.skipIf(!existsSync(RAW_MODS))("Body Armour mods follow mods.json key order (raw cache present)", () => {
    const raw = JSON.parse(readFileSync(RAW_MODS, "utf8")) as Record<string, { domain: string; generation_type: string }>;
    const keyOrder = new Map<string, number>();
    Object.keys(raw).forEach((id, i) => keyOrder.set(id, i));
    let previous = -1;
    for (const m of bodyArmour.mods) {
      const pos = keyOrder.get(m.id);
      expect(pos, `${m.id} is not in mods.json`).toBeDefined();
      expect(pos ?? -1, `${m.id} is out of mods.json order`).toBeGreaterThan(previous);
      previous = pos ?? -1;
      const r = raw[m.id];
      expect(r?.domain).toBe("item");
      expect(r?.generation_type).toBe(m.side);
    }
  });
});
