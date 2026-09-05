// Milestone 3 check (BRIEF.md §7.3): every real Ctrl+Alt+C paste in test/fixtures/items parses to
// the right base, item level, mods and tiers. Two layers:
//   1. invariants for every fixture, including ones dropped in later: it parses (or throws exactly
//      the error its "# expect-error:" line names), every pool mod with an in-game tier either
//      passed the cross-check or carries a "mismatch" that the fixture declares, every warning the
//      parser raised is declared by a "# expect-warning:" line (so a new paste's findings surface
//      as a failing test quoting the warning), slots are consistent;
//   2. an expectation table for the fixtures we know, checked field by field.
// A summary table is printed at the end, parity-style.

import { afterAll, describe, expect, it } from "vitest";

import { ParseError } from "../../src/parse/itemText.ts";
import type { Item, ItemMod, Metamod, ModKind } from "../../src/parse/itemText.ts";
import { listFixtures, parseItemFromText, readFixture } from "../helpers/data.ts";

interface ModExpectation {
  side: "prefix" | "suffix";
  name: string;
  kind: ModKind;
  modId?: string | null;
  tier?: number | null;
  rank?: number | null;
  ourTier?: number | null;
  tierCheck?: ItemMod["tierCheck"];
  crafted?: boolean;
  fractured?: boolean;
  influences?: string[];
  domain?: string;
}

interface Expectation {
  itemClass: string;
  baseId?: string;
  baseName: string;
  rarity: Item["rarity"];
  ilvl: number;
  name?: string | null;
  influences?: string[];
  corrupted?: boolean;
  mirrored?: boolean;
  split?: boolean;
  synthesised?: boolean;
  vestigial?: boolean;
  fracturedItem?: boolean;
  implicits?: number;
  eldritchImplicits?: number;
  enchants?: number;
  uniqueMods?: number;
  slots?: { maxPrefixes: number; maxSuffixes: number; openPrefixes: number; openSuffixes: number };
  metamods?: Metamod[];
  mods?: ModExpectation[];
  /** Number of warnings on the parsed item (their text is declared in the fixture's "# expect-warning:" lines). */
  warnings?: number;
}

const EXPECT: Record<string, Expectation> = {
  // Cameron's own items (3.29, 05/09/2026): the first pastes with in-game tier numbers for
  // multi-type groups, and the reason the tier ladders are keyed per (group, side, type).
  "rare-staff-crafted-rank-gem-level": {
    itemClass: "Staff",
    baseId: "Metadata/Items/Weapons/TwoHandWeapons/Staves/Staff18",
    baseName: "Imperial Staff",
    rarity: "rare",
    ilvl: 87,
    name: "Woe Bane",
    implicits: 1,
    enchants: 2,
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 0, openSuffixes: 0 },
    metamods: [],
    warnings: 0,
    mods: [
      // T5 on the old (group, side) ladder, behind the fire/cold/lightning/chaos families at the same level; T1 per type, as the game says.
      { side: "prefix", name: "Stone Singer's", kind: "pool", modId: "GlobalPhysicalSpellGemsLevelTwoHand3", tier: 1, ourTier: 1, tierCheck: "ok" },
      { side: "prefix", name: "Archon's", kind: "pool", modId: "GlobalSpellGemsLevelTwoHand2", tier: 1, ourTier: 1, tierCheck: "ok" },
      { side: "prefix", name: "Runic", kind: "pool", modId: "SpellDamageOnTwoHandWeapon8", tier: 1, ourTier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Destruction", kind: "pool", modId: "LocalCriticalMultiplier6", tier: 1, ourTier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Finesse", kind: "pool", modId: "IncreasedCastSpeedTwoHand7", tier: 1, ourTier: 1, tierCheck: "ok" },
      // "(Rank: 2)" on the bench craft equals the bench option's bench_tier (VERIFY 14, second data point).
      { side: "suffix", name: "of Craft", kind: "crafted", modId: "EinharMasterCriticalStrikeChanceSpells2h2_", tier: null, rank: 2, crafted: true, tierCheck: "no-ladder" },
    ],
  },
  "rare-body-armour-fractured-delve-eldritch-heist-enchant": {
    itemClass: "Body Armour",
    baseId: "Metadata/Items/Armours/BodyArmours/BodyInt20",
    baseName: "Twilight Regalia",
    rarity: "rare",
    ilvl: 88,
    name: "Apocalypse Coat",
    influences: ["searing-exarch", "eater-of-worlds"],
    fracturedItem: true,
    implicits: 0,
    eldritchImplicits: 2,
    enchants: 1,
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 0, openSuffixes: 0 },
    metamods: [],
    warnings: 1,
    mods: [
      { side: "prefix", name: "Unfaltering", kind: "pool", modId: "LocalIncreasedEnergyShieldPercent8", tier: 1, ourTier: 1, tierCheck: "ok" },
      // T4 on the old shared BaseLocalDefencesAndLife ladder; T2 of its own hybrid ES + mana family, as the game says.
      { side: "prefix", name: "Priest's", kind: "pool", modId: "LocalBaseEnergyShieldAndMana3", tier: 2, ourTier: 2, tierCheck: "ok" },
      { side: "prefix", name: "Resplendent", kind: "pool", modId: "LocalIncreasedEnergyShield11", tier: 1, ourTier: 1, tierCheck: "ok" },
      // Delve (fossil-only) mod: in no class file, resolved from other_mods; the game prints a tier on it, the engine has no ladder.
      { side: "suffix", name: "of the Underground", kind: "other", modId: "DelveDexterityGemLevel1", domain: "delve", tier: 1, ourTier: null, tierCheck: "no-ladder", fractured: true },
      // Unveiled mod printed with a tier (VERIFY 15): recorded, not checked.
      { side: "suffix", name: "of the Order", kind: "unveiled", modId: "JunMasterVeiledColdAndChaosDamageResistance", tier: 1, ourTier: null, tierCheck: "no-ladder" },
      { side: "suffix", name: "of Craft", kind: "crafted", modId: "JunMaster2StrengthAndIntelligence3", tier: null, rank: null, crafted: true },
    ],
  },
  "magic-body-armour-prefix-suffix": {
    itemClass: "Body Armour",
    baseId: "Metadata/Items/Armours/BodyArmours/BodyStr18",
    baseName: "Titan Plate",
    rarity: "magic",
    ilvl: 85,
    name: null,
    implicits: 0,
    slots: { maxPrefixes: 1, maxSuffixes: 1, openPrefixes: 0, openSuffixes: 0 },
    warnings: 0,
    mods: [
      { side: "prefix", name: "Vigorous", kind: "pool", modId: "IncreasedLife10", tier: 3, ourTier: 3, tierCheck: "ok" },
      { side: "suffix", name: "of Thick Skin", kind: "pool", modId: "StunRecovery1", tier: 6, ourTier: 6, tierCheck: "ok" },
    ],
  },
  // Until 05/09/2026 these two threw TierMismatchError (STATUS.md VERIFY 7 and 13).
  "magic-staff-prefix-suffix": {
    itemClass: "Staff",
    baseId: "Metadata/Items/Weapons/TwoHandWeapons/Staves/Staff18",
    baseName: "Imperial Staff",
    rarity: "magic",
    ilvl: 85,
    implicits: 1,
    slots: { maxPrefixes: 1, maxSuffixes: 1, openPrefixes: 0, openSuffixes: 0 },
    warnings: 0,
    mods: [
      { side: "prefix", name: "Schismatist's", kind: "pool", modId: "GlobalChaosSpellGemsLevelTwoHand3", tier: 1, ourTier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of the Titan", kind: "pool", modId: "Strength8", tier: 2, ourTier: 2, tierCheck: "ok" },
    ],
  },
  "rare-amulet-corrupted-vaal-implicit": {
    itemClass: "Amulet",
    baseId: "Metadata/Items/Amulets/Amulet10",
    baseName: "Citrine Amulet",
    rarity: "rare",
    ilvl: 80,
    name: "Pandemonium Idol",
    corrupted: true,
    implicits: 1,
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 1, openSuffixes: 1 },
    warnings: 1,
    mods: [
      { side: "prefix", name: "Burning", kind: "pool", modId: "AddedFireDamage4", tier: 6, ourTier: 6, tierCheck: "ok" },
      // VERIFY 13, still open: the game says Tier 4, RePoE and Path of Building have five amulet spell damage tiers, so T2. One warning, no throw.
      { side: "prefix", name: "Thaumaturgist's", kind: "pool", modId: "SpellDamage4", tier: 4, ourTier: 2, tierCheck: "mismatch" },
      { side: "suffix", name: "of the Heavens", kind: "pool", modId: "AllAttributes5", tier: 5, ourTier: 5, tierCheck: "ok" },
      { side: "suffix", name: "of Sleet", kind: "pool", modId: "ColdDamagePercent2", tier: 4, ourTier: 4, tierCheck: "ok" },
    ],
  },
  "rare-gloves-crafted-rank-eldritch": {
    itemClass: "Gloves",
    baseId: "Metadata/Items/Armours/Gloves/GlovesDexInt8",
    baseName: "Murder Mitts",
    rarity: "rare",
    ilvl: 84,
    name: "Tempest Vise",
    influences: ["searing-exarch", "eater-of-worlds"],
    implicits: 0,
    eldritchImplicits: 2,
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 0, openSuffixes: 0 },
    metamods: [],
    mods: [
      { side: "prefix", name: "Virile", kind: "pool", modId: "IncreasedLife7", tier: 2, ourTier: 2, tierCheck: "ok" },
      { side: "prefix", name: "Mazarine", kind: "pool", modId: "IncreasedMana10", tier: 3, ourTier: 3, tierCheck: "ok" },
      { side: "prefix", name: "Upgraded", kind: "crafted", modId: "EinharMasterEvasionAndEnergyShieldPercent3", rank: 3, crafted: true },
      { side: "suffix", name: "of Infamy", kind: "other", modId: "MercenaryModTrapMineChain", domain: "mercenary", tier: 1 },
      { side: "suffix", name: "of the Volcano", kind: "pool", modId: "FireResist6", tier: 3, tierCheck: "ok" },
      { side: "suffix", name: "of Abjuration", kind: "pool", modId: "ChanceToSuppressSpells4", tier: 2, tierCheck: "ok" },
    ],
  },
  "rare-ring-fractured-crafted-4-suffixes": {
    itemClass: "Ring",
    baseId: "Metadata/Items/Rings/RingE6",
    baseName: "Helical Ring",
    rarity: "rare",
    ilvl: 84,
    name: "Torment Hold",
    split: true,
    fracturedItem: true,
    implicits: 1,
    slots: { maxPrefixes: 1, maxSuffixes: 4, openPrefixes: 0, openSuffixes: 0 },
    mods: [
      { side: "prefix", name: "Robust", kind: "pool", modId: "IncreasedLife5", tier: 3, tierCheck: "ok" },
      { side: "suffix", name: "of the Rainbow", kind: "pool", modId: "AllResistances5", tier: 1, tierCheck: "ok", fractured: true },
      { side: "suffix", name: "of Bameth", kind: "pool", modId: "ChaosResist6", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Tzteosh", kind: "pool", modId: "FireResist8", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Craft", kind: "crafted", modId: "JunMaster2FireAndChaosDamageResistance3", crafted: true, rank: null },
    ],
  },
  "rare-helmet-corrupted-vestigial-hybrids": {
    itemClass: "Helmet",
    baseName: "Secutor Helm",
    rarity: "rare",
    ilvl: 85,
    name: "Havoc Ward",
    corrupted: true,
    vestigial: true,
    implicits: 1,
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 0, openSuffixes: 0 },
    mods: [
      { side: "prefix", name: "Dragon's", kind: "pool", modId: "ItemFoundRarityIncreasePrefix3", tier: 1, tierCheck: "ok" },
      { side: "prefix", name: "Brawler's", kind: "pool", modId: "LocalIncreasedArmourAndEvasion2", tier: 6, tierCheck: "ok" },
      { side: "prefix", name: "Rhino's", kind: "pool", modId: "LocalIncreasedArmourAndEvasionAndStunRecovery4", tier: 3, tierCheck: "ok" },
      { side: "suffix", name: "of Excavation", kind: "pool", modId: "ItemFoundRarityIncrease4", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of the Sniper", kind: "pool", modId: "IncreasedAccuracyNew3", tier: 4, tierCheck: "ok" },
      { side: "suffix", name: "of the Thunderhead", kind: "pool", modId: "LightningResist4", tier: 5, tierCheck: "ok" },
    ],
  },
  "rare-quiver-crafted-metamod-no-attack": {
    itemClass: "Quiver",
    baseId: "Metadata/Items/Quivers/QuiverNew10",
    baseName: "Broadhead Arrow Quiver",
    rarity: "rare",
    ilvl: 87,
    name: "Honour Flight",
    implicits: 1,
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 0, openSuffixes: 0 },
    metamods: ["no-attack-mods"],
    mods: [
      { side: "prefix", name: "Electrocuting", kind: "pool", modId: "AddedLightningDamageQuiver9", tier: 1, tierCheck: "ok" },
      { side: "prefix", name: "Fecund", kind: "pool", modId: "IncreasedLife9", tier: 1, tierCheck: "ok" },
      { side: "prefix", name: "Impaling", kind: "pool", modId: "DamageWithBowSkills6_", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Destruction", kind: "pool", modId: "CriticalMultiplierWithBows6", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Splintering", kind: "pool", modId: "AdditionalArrowQuiver1_", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Spellcraft", kind: "crafted", modId: "IntMasterItemGenerationCannotRollAttackAffixes", crafted: true },
    ],
  },
  "rare-boots-hybrid-defence-mods": {
    itemClass: "Boots",
    baseName: "Vaal Greaves",
    rarity: "rare",
    ilvl: 86,
    name: "Blood Stride",
    slots: { maxPrefixes: 3, maxSuffixes: 3, openPrefixes: 0, openSuffixes: 0 },
    mods: [
      { side: "prefix", name: "Virile", kind: "pool", modId: "IncreasedLife7", tier: 2, tierCheck: "ok" },
      { side: "prefix", name: "Urchin's", kind: "pool", modId: "LocalBaseArmourAndLife2", tier: 1, tierCheck: "ok" },
      { side: "prefix", name: "Mammoth's", kind: "pool", modId: "LocalIncreasedPhysicalDamageReductionRatingPercentAndStunRecovery6", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of the Apt", kind: "pool", modId: "ReducedLocalAttributeRequirements2", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of the Troll", kind: "pool", modId: "LifeRegeneration6", tier: 3, tierCheck: "ok" },
      { side: "suffix", name: "of Tzteosh", kind: "pool", modId: "FireResist8", tier: 1, tierCheck: "ok" },
    ],
  },
  "rare-amulet-shaper-elder-mirrored-quantity": {
    itemClass: "Amulet",
    baseId: "Metadata/Items/Amulets/AmuletE2",
    baseName: "Simplex Amulet",
    rarity: "rare",
    ilvl: 87,
    name: "Grim Collar",
    influences: ["shaper", "elder"],
    mirrored: true,
    split: true,
    implicits: 1,
    enchants: 1,
    slots: { maxPrefixes: 1, maxSuffixes: 2, openPrefixes: 0, openSuffixes: 0 },
    mods: [
      { side: "prefix", name: "The Elder's", kind: "influence", modId: null, tier: 1, influences: ["elder"] },
      { side: "suffix", name: "of Destruction", kind: "pool", modId: "CriticalMultiplier6", tier: 1, tierCheck: "ok" },
      { side: "suffix", name: "of Amassment", kind: "other", modId: "ItemFoundQuantityIncrease4", domain: "item", tier: null },
    ],
  },
  "magic-boots-1-prefix": {
    itemClass: "Boots",
    baseName: "Wyvernscale Boots",
    rarity: "magic",
    ilvl: 84,
    name: null,
    slots: { maxPrefixes: 1, maxSuffixes: 1, openPrefixes: 0, openSuffixes: 1 },
    mods: [{ side: "prefix", name: "Fencer's", kind: "pool", modId: "LocalIncreasedArmourAndEvasion3", tier: 5, tierCheck: "ok" }],
  },
  "magic-ring-1-prefix-two-stone": {
    itemClass: "Ring",
    baseId: "Metadata/Items/Rings/Ring14",
    baseName: "Two-Stone Ring",
    rarity: "magic",
    ilvl: 85,
    implicits: 1,
    slots: { maxPrefixes: 1, maxSuffixes: 1, openPrefixes: 0, openSuffixes: 1 },
    mods: [{ side: "prefix", name: "Glittering", kind: "pool", modId: "IncreasedEnergyShield3", tier: 9, tierCheck: "ok" }],
  },
  "magic-boots-1-prefix-fractured": {
    itemClass: "Boots",
    baseName: "Warlock Boots",
    rarity: "magic",
    ilvl: 86,
    fracturedItem: true,
    slots: { maxPrefixes: 1, maxSuffixes: 1, openPrefixes: 0, openSuffixes: 1 },
    mods: [{ side: "prefix", name: "Hellion's", kind: "pool", modId: "MovementVelocity6", tier: 1, tierCheck: "ok", fractured: true }],
  },
  "magic-sceptre-prefix-suffix": {
    itemClass: "Sceptre",
    baseName: "Void Sceptre",
    rarity: "magic",
    ilvl: 85,
    implicits: 1,
    slots: { maxPrefixes: 1, maxSuffixes: 1, openPrefixes: 0, openSuffixes: 0 },
    mods: [
      { side: "prefix", name: "Scorching", kind: "pool", modId: "LocalAddedFireDamage6", tier: 5, tierCheck: "ok" },
      { side: "suffix", name: "of Dissolution", kind: "pool", modId: "GlobalDamageOverTimeMultiplier1h5", tier: 1, tierCheck: "ok" },
    ],
  },
  "normal-wand": {
    itemClass: "Wand",
    baseName: "Kinetic Wand",
    rarity: "normal",
    ilvl: 84,
    name: null,
    implicits: 1,
    slots: { maxPrefixes: 0, maxSuffixes: 0, openPrefixes: 0, openSuffixes: 0 },
    mods: [],
  },
  "normal-staff-ilvl15": {
    itemClass: "Staff",
    baseName: "Primitive Staff",
    rarity: "normal",
    ilvl: 15,
    implicits: 1,
    mods: [],
  },
  "unique-shield-corrupted": {
    itemClass: "Shield",
    baseName: "Champion Kite Shield",
    rarity: "unique",
    ilvl: 83,
    name: "Aegis Aurora",
    corrupted: true,
    implicits: 1,
    uniqueMods: 6,
    mods: [],
  },
  "unique-warstaff-unveiled-mods": {
    itemClass: "Warstaff",
    baseName: "Serpentine Staff",
    rarity: "unique",
    ilvl: 85,
    name: "Cane of Kulemak",
    implicits: 1,
    uniqueMods: 1,
    mods: [
      { side: "prefix", name: "Chosen", kind: "unique", modId: null, tier: 1 },
      { side: "prefix", name: "Chosen", kind: "unique", modId: null, tier: 1 },
      { side: "suffix", name: "of the Order", kind: "unique", modId: null, tier: 1 },
    ],
  },
};

interface Row {
  name: string;
  outcome: string;
  detail: string;
}

const rows: Row[] = [];

describe("fixtures: real Ctrl+Alt+C pastes", () => {
  const names = listFixtures();

  it("has at least 12 fixtures", () => {
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  for (const name of names) {
    it(name, () => {
      const fx = readFixture(name);
      expect(fx.source, 'every fixture needs a "# source:" line (a URL, or "own stash, DD/MM/YYYY")').toBeTruthy();

      if (fx.expectError) {
        let caught: unknown;
        try {
          parseItemFromText(fx.text);
        } catch (e) {
          caught = e;
        }
        expect(caught, `expected ${fx.expectError}`).toBeInstanceOf(ParseError);
        expect((caught as Error).name).toBe(fx.expectError);
        rows.push({ name, outcome: `throws ${fx.expectError}`, detail: (caught as Error).message.slice(0, 90) });
        return;
      }

      const item = parseItemFromText(fx.text);
      // Invariants for every fixture, including ones added later.
      expect(item.ilvl).toBeGreaterThan(0);
      expect(item.base.id).toMatch(/^Metadata\//);
      for (const m of item.mods) {
        if (m.kind === "pool" && m.tier !== null && m.ourTier !== null) {
          // A mismatch is allowed only when the fixture declares its warning below.
          expect(["ok", "mismatch"], `${m.side} ${m.name} tier cross-check`).toContain(m.tierCheck);
          if (m.tierCheck === "ok") expect(m.ourTier).toBe(m.tier);
          else expect(m.ourTier).not.toBe(m.tier);
        }
        if (m.kind !== "influence" && m.kind !== "unique") expect(m.modId, `${m.side} ${m.name} modId`).not.toBeNull();
      }
      // Every warning must be declared ("# expect-warning: <text>", one line per warning), so a
      // new paste that warns fails here with the warning quoted instead of passing quietly.
      expect(item.warnings, 'every warning needs a "# expect-warning:" line in the fixture').toHaveLength(fx.expectWarnings.length);
      for (const w of fx.expectWarnings) {
        expect(item.warnings.some((x) => x.includes(w)), `no warning contains ${JSON.stringify(w)}; got ${JSON.stringify(item.warnings)}`).toBe(true);
      }
      if (item.rarity !== "unique") {
        expect(item.mods.filter((m) => m.side === "prefix").length).toBeLessThanOrEqual(item.maxPrefixes);
        expect(item.mods.filter((m) => m.side === "suffix").length).toBeLessThanOrEqual(item.maxSuffixes);
      }
      expect(item.openPrefixes).toBeGreaterThanOrEqual(0);
      expect(item.openSuffixes).toBeGreaterThanOrEqual(0);

      const want = EXPECT[name];
      if (want) {
        expect(item.itemClass).toBe(want.itemClass);
        expect(item.base.name).toBe(want.baseName);
        if (want.baseId !== undefined) expect(item.base.id).toBe(want.baseId);
        expect(item.rarity).toBe(want.rarity);
        expect(item.ilvl).toBe(want.ilvl);
        if (want.name !== undefined) expect(item.name).toBe(want.name);
        if (want.influences) expect(item.influences).toEqual(want.influences);
        expect(item.corrupted).toBe(want.corrupted ?? false);
        expect(item.mirrored).toBe(want.mirrored ?? false);
        expect(item.split).toBe(want.split ?? false);
        expect(item.synthesised).toBe(want.synthesised ?? false);
        expect(item.vestigial).toBe(want.vestigial ?? false);
        expect(item.fracturedItem).toBe(want.fracturedItem ?? false);
        if (want.implicits !== undefined) expect(item.implicits.length).toBe(want.implicits);
        if (want.eldritchImplicits !== undefined) expect(item.eldritchImplicits.length).toBe(want.eldritchImplicits);
        if (want.enchants !== undefined) expect(item.enchants.length).toBe(want.enchants);
        if (want.uniqueMods !== undefined) expect(item.uniqueMods.length).toBe(want.uniqueMods);
        if (want.slots) {
          expect({ maxPrefixes: item.maxPrefixes, maxSuffixes: item.maxSuffixes, openPrefixes: item.openPrefixes, openSuffixes: item.openSuffixes }).toEqual(want.slots);
        }
        if (want.metamods) expect(item.metamods).toEqual(want.metamods);
        if (want.warnings !== undefined) expect(item.warnings, "warnings").toHaveLength(want.warnings);
        if (want.mods) {
          expect(item.mods.map((m) => `${m.side} ${m.name}`)).toEqual(want.mods.map((m) => `${m.side} ${m.name}`));
          want.mods.forEach((w, i) => {
            const m = item.mods[i]!;
            const label = `${w.side} ${w.name}`;
            expect(m.kind, `${label} kind`).toBe(w.kind);
            if (w.modId !== undefined) expect(m.modId, `${label} modId`).toBe(w.modId);
            if (w.tier !== undefined) expect(m.tier, `${label} tier`).toBe(w.tier);
            if (w.rank !== undefined) expect(m.rank, `${label} rank`).toBe(w.rank);
            if (w.ourTier !== undefined) expect(m.ourTier, `${label} ourTier`).toBe(w.ourTier);
            if (w.tierCheck !== undefined) expect(m.tierCheck, `${label} tierCheck`).toBe(w.tierCheck);
            if (w.crafted !== undefined) expect(m.flags.crafted, `${label} crafted`).toBe(w.crafted);
            if (w.fractured !== undefined) expect(m.flags.fractured, `${label} fractured`).toBe(w.fractured);
            if (w.influences !== undefined) expect(m.influences, `${label} influences`).toEqual(w.influences);
            if (w.domain !== undefined) expect(m.domain, `${label} domain`).toBe(w.domain);
          });
        }
      }

      const p = item.mods.filter((m) => m.side === "prefix").length;
      const s = item.mods.filter((m) => m.side === "suffix").length;
      const kinds = new Map<string, number>();
      for (const m of item.mods) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
      const checked = item.mods.filter((m) => m.tierCheck === "ok").length;
      const mismatched = item.mods.filter((m) => m.tierCheck === "mismatch").length;
      rows.push({
        name,
        outcome: `${item.rarity} ${item.base.id.split("/").pop()} ilvl ${item.ilvl}`,
        detail:
          `P${p}/${item.maxPrefixes} S${s}/${item.maxSuffixes} open ${item.openPrefixes}/${item.openSuffixes}; ` +
          `${[...kinds.entries()].map(([k, n]) => `${n} ${k}`).join(", ") || "no mods"}; tiers ok ${checked}` +
          (mismatched ? `, MISMATCH ${mismatched}` : "") +
          (item.influences.length ? `; ${item.influences.join("+")}` : "") +
          (item.metamods.length ? `; ${item.metamods.join(",")}` : "") +
          (item.corrupted ? "; corrupted" : "") +
          (item.mirrored ? "; mirrored" : "") +
          (item.warnings.length ? `; ${item.warnings.length} warning${item.warnings.length > 1 ? "s" : ""}` : ""),
      });
    });
  }

  it("every fixture in the expectation table exists", () => {
    for (const name of Object.keys(EXPECT)) expect(names, `expected fixture ${name}`).toContain(name);
  });
});

afterAll(() => {
  if (rows.length === 0) return;
  const w = Math.max(...rows.map((r) => r.name.length));
  const lines = rows.map((r) => `${r.name.padEnd(w)} | ${r.outcome.padEnd(34)} | ${r.detail}`);
  console.log(`\nfixture parse summary (${rows.length} fixtures):\n${lines.join("\n")}\n`);
});
