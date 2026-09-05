// Unit tests for the parser's error paths and the cases no real paste covers yet. The synthetic
// texts are built from real fixtures with one line changed or appended, in the format the real
// pastes use; each such case says so.

import { describe, expect, it } from "vitest";

import {
  AmbiguousBaseError,
  ParseError,
  UnknownBaseError,
  UnknownModError,
  UnsupportedItemClassError,
  detectItemClass,
  parseItem,
  parseItemText,
} from "../../src/parse/itemText.ts";
import { rangesContained, rangesOf, stripTrailers, templateOf, valuesOf } from "../../src/parse/text.ts";
import { loadIndex, loadOtherMods, loadPoolFileByClass, parseItemFromText, readFixture } from "../helpers/data.ts";

/** The pasted text of a fixture without its "#" provenance lines. */
function fixtureText(name: string): string {
  return readFixture(name)
    .text.split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n");
}

/** Remove one explicit mod (its header and stat lines) from a paste. */
function withoutMod(text: string, name: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const l of text.split("\n")) {
    if (l.startsWith("{ ") && l.includes(`"${name}"`)) {
      skipping = true;
      continue;
    }
    if (skipping && (l.startsWith("{ ") || l === "--------" || / Item$/.test(l))) skipping = false;
    if (!skipping) out.push(l);
  }
  return out.join("\n");
}

/** 1-based line number of the first line containing `needle`. */
function lineOf(text: string, needle: string): number {
  const i = text.split("\n").findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`no line contains ${JSON.stringify(needle)}`);
  return i + 1;
}

/** Murder Mitts with a prefix and a suffix removed: a real rare with one open slot per side for the synthetic cases. */
function glovesWithOpenSlots(): string {
  return withoutMod(withoutMod(fixtureText("rare-gloves-crafted-rank-eldritch"), "Mazarine"), "of Infamy");
}

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`fixture text does not contain ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

describe("text helpers", () => {
  it("templateOf reduces rolls, ranges and fixed values to #", () => {
    expect(templateOf("+105(100-114) to maximum Life")).toBe("+# to maximum Life");
    expect(templateOf("+(100-114) to maximum Life")).toBe("+# to maximum Life");
    expect(templateOf("Adds 34(34-46) to 77(68-80) Fire Damage")).toBe("Adds # to # Fire Damage");
    expect(templateOf("Adds (34-46) to (68-80) Fire Damage")).toBe("Adds # to # Fire Damage");
    expect(templateOf("+2(1) to Minimum Endurance Charges")).toBe("+# to Minimum Endurance Charges");
    expect(templateOf("Regenerate 43.8(32.1-48) Life per second")).toBe("Regenerate # Life per second");
    expect(templateOf("-2 Prefix Modifiers allowed")).toBe("-# Prefix Modifiers allowed");
    expect(templateOf("Non-Channelling Skills have -7(-7--6) to Total Mana Cost")).toBe("Non-Channelling Skills have -# to Total Mana Cost");
    expect(templateOf("35% increased Movement Speed")).toBe("#% increased Movement Speed");
  });

  it("rangesOf / valuesOf / rangesContained", () => {
    expect(rangesOf("Adds 34(34-46) to 77(68-80) Fire Damage")).toEqual([
      [34, 46],
      [68, 80],
    ]);
    expect(rangesOf("+2(1) to Minimum Endurance Charges")).toEqual([[1, 1]]);
    expect(rangesOf("-7(-7--6) to Total Mana Cost")).toEqual([[-7, -6]]);
    expect(valuesOf("+1 to Minimum Endurance Charges")).toEqual([[1, 1]]);
    expect(rangesContained([[1, 1]], valuesOf("+1 to Minimum Endurance Charges"))).toBe(true);
    expect(rangesContained([[13, 15]], valuesOf("+(13-15)% to Fire and Chaos Resistances"))).toBe(true);
    expect(rangesContained([[13, 15]], valuesOf("+(11-12)% to Fire and Chaos Resistances"))).toBe(false);
    expect(rangesContained([], valuesOf("anything"))).toBe(true);
  });

  it("stripTrailers removes the game's line markers and reports them", () => {
    expect(stripTrailers("+12(8-12)% to Fire and Cold Resistances (implicit)")).toEqual({
      text: "+12(8-12)% to Fire and Cold Resistances",
      trailers: new Set(["implicit"]),
    });
    expect(stripTrailers("Attack Critical Strikes ignore Enemy Monster Elemental Resistances — Unscalable Value (implicit)")).toEqual({
      text: "Attack Critical Strikes ignore Enemy Monster Elemental Resistances",
      trailers: new Set(["implicit", "unscalable"]),
    });
    expect(stripTrailers("+24(20-24) to Strength and Intelligence (crafted)").trailers.has("crafted")).toBe(true);
    expect(stripTrailers("Cannot roll Attack Modifiers — Unscalable Value").text).toBe("Cannot roll Attack Modifiers");
  });
});

describe("parseItemText (structure only)", () => {
  it("reads every header shape seen in real pastes", () => {
    const raw = parseItemText(fixtureText("rare-ring-fractured-crafted-4-suffixes"));
    expect(raw.itemClassName).toBe("Rings");
    expect(raw.rarity).toBe("rare");
    expect(raw.nameLine).toBe("Torment Hold");
    expect(raw.baseLine.text).toBe("Helical Ring");
    expect(raw.ilvl).toBe(84);
    expect(raw.requirements).toEqual({ level: 67 });
    expect(raw.implicits).toHaveLength(1);
    expect(raw.implicits[0]!.lines).toEqual([
      "-2 Prefix Modifiers allowed",
      "+1 Suffix Modifier allowed",
      "Implicit Modifiers Cannot Be Changed",
      "50% increased Suffix Modifier magnitudes",
    ]);
    expect(raw.explicit.map((m) => [m.side, m.name, m.tier, m.rank, m.fractured, m.crafted, m.magnitude])).toEqual([
      ["prefix", "Robust", 3, null, false, false, null],
      ["suffix", "of the Rainbow", 1, null, true, false, "70% Increased"],
      ["suffix", "of Bameth", 1, null, false, false, "70% Increased"],
      ["suffix", "of Tzteosh", 1, null, false, false, "70% Increased"],
      ["suffix", "of Craft", null, null, false, true, "70% Increased"],
    ]);
    expect(raw.explicit[1]!.tags).toEqual(["Elemental", "Resistance"]);
    expect(raw.footers).toEqual(["Split", "Fractured Item"]);
    expect(raw.warnings).toEqual([]);
  });

  it("reads Rank, eldritch implicits with their tier word, reminder lines and footers after the last mod", () => {
    const raw = parseItemText(fixtureText("rare-gloves-crafted-rank-eldritch"));
    const crafted = raw.explicit.find((m) => m.name === "Upgraded")!;
    expect(crafted.rank).toBe(3);
    expect(crafted.tier).toBeNull();
    expect(crafted.crafted).toBe(true);
    expect(raw.implicits.map((b) => [b.kind, b.source, b.eldritchTier])).toEqual([
      ["eldritch", "searing-exarch", "Lesser"],
      ["eldritch", "eater-of-worlds", "Lesser"],
    ]);
    expect(raw.implicits[1]!.lines).toEqual(["+5% chance to Suppress Spell Damage"]); // reminder line dropped
    expect(raw.explicit.find((m) => m.name === "of Abjuration")!.lines).toEqual(["+11(11-12)% chance to Suppress Spell Damage"]);
    expect(raw.footers).toEqual(["Searing Exarch Item", "Eater of Worlds Item"]);
  });

  it("accepts the older client format: (implicit)/(crafted)/(fractured) line markers and blank lines between mods", () => {
    const raw = parseItemText(fixtureText("rare-wand-shaper-elder-crafted"));
    expect(raw.implicits).toHaveLength(1);
    expect(raw.implicits[0]!.lines).toEqual(["39(36-40)% increased Spell Damage"]);
    expect(raw.explicit).toHaveLength(5);
    expect(raw.explicit[4]!.crafted).toBe(true);
    expect(raw.explicit[4]!.lines).toEqual(["10(10-11)% increased Attack Speed while a Rare or Unique Enemy is Nearby"]);
    const boots = parseItemText(fixtureText("magic-boots-1-prefix-fractured"));
    expect(boots.explicit[0]!.fractured).toBe(true);
    expect(boots.explicit[0]!.lines).toEqual(["35% increased Movement Speed"]);
  });

  it("ignores leading # comment lines and CRLF line endings", () => {
    const text = readFixture("magic-boots-1-prefix").text;
    const a = parseItemText(text);
    const b = parseItemText(text.replace(/\n/g, "\r\n"));
    expect(a).toEqual(b);
    expect(a.explicit[0]!.line).toBe(15); // line numbers count the comment lines, as pasted
  });

  it("rejects text without an Item Class line, non-equipment rarities and unidentified items", () => {
    expect(() => parseItemText("")).toThrow(ParseError);
    expect(() => parseItemText("Rarity: Rare\nFoo\nBar")).toThrow(/Item Class/);
    expect(() => parseItemText("Item Class: Stackable Currency\nRarity: Currency\nChaos Orb")).toThrow(/rarity "Currency"/);
    const unid = replaceOnce(fixtureText("magic-boots-1-prefix"), "Item Level: 84", "Item Level: 84\n--------\nUnidentified");
    expect(() => parseItemText(unid)).toThrow(/unidentified/);
  });

  it("fails loudly on a modifier header it does not know", () => {
    const text = replaceOnce(fixtureText("magic-boots-1-prefix"), '{ Prefix Modifier "Fencer\'s"', '{ Warped Prefix Modifier "Fencer\'s"');
    expect(() => parseItemText(text)).toThrow(/unrecognised modifier header/);
  });
});

describe("detectItemClass", () => {
  it("maps the display name to the class file", () => {
    const index = loadIndex();
    expect(detectItemClass(fixtureText("rare-quiver-crafted-metamod-no-attack"), index)).toEqual({ itemClassName: "Quivers", itemClass: "Quiver", file: "Quiver.json.gz" });
    expect(detectItemClass("Item Class: Rune Daggers\nRarity: Normal\nX", index).itemClass).toBe("Rune Dagger");
    expect(detectItemClass("Item Class: Thrusting One Hand Swords\nRarity: Normal\nX", index).itemClass).toBe("Thrusting One Hand Sword");
  });

  it("throws UnsupportedItemClassError for jewels and flasks, naming the class", () => {
    const index = loadIndex();
    for (const [name, cls] of [
      ["unsupported-jewel-rare", "Jewels"],
      ["unsupported-flask-unique", "Utility Flasks"],
    ] as const) {
      let caught: unknown;
      try {
        detectItemClass(fixtureText(name), index);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(UnsupportedItemClassError);
      expect((caught as UnsupportedItemClassError).itemClassName).toBe(cls);
      expect((caught as UnsupportedItemClassError).code).toBe("unsupported-class");
    }
  });
});

describe("resolveItem error paths", () => {
  it("unknown mod name: UnknownModError naming the line, never a guess", () => {
    const text = replaceOnce(fixtureText("rare-quiver-crafted-metamod-no-attack"), '{ Suffix Modifier "of Splintering" (Tier: 1)', '{ Suffix Modifier "of Splinters" (Tier: 1)');
    const line = lineOf(text, "of Splinters");
    let caught: unknown;
    try {
      parseItemFromText(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnknownModError);
    const err = caught as UnknownModError;
    expect(err.code).toBe("unknown-mod");
    expect(err.modName).toBe("of Splinters");
    expect(err.side).toBe("suffix");
    expect(err.line).toBe(line);
    expect(err.lineText).toContain("of Splinters");
    expect(err.message).toMatch(new RegExp(`line ${line}`));
    expect(err.nearMisses).toEqual([]);
  });

  it("same name, different text: UnknownModError lists the near misses", () => {
    const text = replaceOnce(fixtureText("magic-boots-1-prefix"), "52(43-55)% increased Armour and Evasion", "52(43-55)% increased Armour and Evasion and Energy Shield");
    let caught: unknown;
    try {
      parseItemFromText(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnknownModError);
    expect((caught as UnknownModError).nearMisses.some((n) => n.startsWith("LocalIncreasedArmourAndEvasion3:"))).toBe(true);
  });

  it("tier cross-check: an in-game tier that differs from the engine's ladder is a warning on the item, never a throw", () => {
    // The real paste says (Tier: 5) and parses with no warning at all.
    expect(parseItemFromText(fixtureText("magic-boots-1-prefix")).warnings).toEqual([]);
    const text = replaceOnce(fixtureText("magic-boots-1-prefix"), "(Tier: 5)", "(Tier: 1)");
    const item = parseItemFromText(text);
    const m = item.mods[0]!;
    // Resolution is by name, side, text and ranges, so the mod is still the right one.
    expect(m.kind).toBe("pool");
    expect(m.modId).toBe("LocalIncreasedArmourAndEvasion3");
    expect(m.tier).toBe(1);
    expect(m.ourTier).toBe(5);
    expect(m.tierCheck).toBe("mismatch");
    expect(item.warnings).toHaveLength(1);
    const w = item.warnings[0]!;
    expect(w).toMatch(/^prefix "Fencer's" \(LocalIncreasedArmourAndEvasion3\): the game says Tier 1, the engine's ladder DefencesPercent\|prefix\|\w+ says T5; resolved by name, side and text, the number is informational\. Ladder: T1 L\d+ /);
    expect(w).toMatch(/T5 L\d+ LocalIncreasedArmourAndEvasion3 "/);
    expect(w).toMatch(new RegExp(`\\(line ${lineOf(text, "(Tier: 1)")}\\)$`));
    // The ladder in the warning is the mod's own (group, side, type) family, dense from T1.
    const tiers = [...w.matchAll(/T(\d+) L\d+ \w+ "/g)].map((x) => Number(x[1]));
    expect(tiers).toEqual(tiers.map((_, i) => i + 1));
  });

  it("unknown base: UnknownBaseError", () => {
    const text = replaceOnce(fixtureText("normal-wand"), "Kinetic Wand\n", "Kinetic Wandering\n");
    expect(() => parseItemFromText(text)).toThrow(UnknownBaseError);
  });

  it("same-name bases: the implicit decides, and a corruption that replaced it makes the base ambiguous", () => {
    const ring = parseItemFromText(fixtureText("magic-ring-1-prefix-two-stone"));
    expect(ring.base.id).toBe("Metadata/Items/Rings/Ring14"); // fire + cold
    const lightning = replaceOnce(fixtureText("magic-ring-1-prefix-two-stone"), "+12(12-16)% to Fire and Cold Resistances (implicit)", "+12(12-16)% to Cold and Lightning Resistances (implicit)");
    expect(parseItemFromText(lightning).base.id).toBe("Metadata/Items/Rings/Ring13");
    const corrupted = replaceOnce(
      fixtureText("magic-ring-1-prefix-two-stone"),
      "{ Implicit Modifier — Elemental, Fire, Cold, Resistance }\n+12(12-16)% to Fire and Cold Resistances (implicit)",
      "{ Corruption Implicit Modifier }\n+1 to Level of Socketed Gems",
    ).concat("\n--------\nCorrupted\n");
    let caught: unknown;
    try {
      parseItemFromText(corrupted);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AmbiguousBaseError);
    expect((caught as AmbiguousBaseError).candidates.sort()).toEqual(["Metadata/Items/Rings/Ring12", "Metadata/Items/Rings/Ring13", "Metadata/Items/Rings/Ring14"]);
    expect((caught as Error).message).toMatch(/corruption replaced the implicit/);
  });

  it("refuses a class file that does not match the item", () => {
    const index = loadIndex();
    expect(() => parseItem(fixtureText("normal-wand"), { index, classFile: loadPoolFileByClass("Boots"), otherMods: loadOtherMods() })).toThrow(/class file given is Boots/);
  });
});

describe("resolveItem cases without a real paste yet", () => {
  // Format of the two synthetic mods below: the quiver fixture's real metamod line is
  //   { Master Crafted Suffix Modifier "of Spellcraft" }
  //   Cannot roll Attack Modifiers — Unscalable Value
  // and "of Prefixes" / "Suffixed" are the RePoE names of the other two lock metamods.
  it('"Prefixes Cannot Be Changed" (synthetic, from the real metamod format): prefixes-locked, crafted, fills a suffix', () => {
    const host = glovesWithOpenSlots();
    expect(parseItemFromText(host)).toMatchObject({ openPrefixes: 1, openSuffixes: 1, metamods: [] });
    const text = replaceOnce(host, "\nSearing Exarch Item", '\n{ Master Crafted Suffix Modifier "of Prefixes" }\nPrefixes Cannot Be Changed — Unscalable Value\nSearing Exarch Item');
    const item = parseItemFromText(text);
    const meta = item.mods.find((m) => m.name === "of Prefixes")!;
    expect(meta.kind).toBe("crafted");
    expect(meta.modId).toBe("StrMasterItemGenerationCannotChangePrefixes");
    expect(meta.flags.crafted).toBe(true);
    expect(meta.text).toBe("Prefixes Cannot Be Changed");
    expect(item.metamods).toEqual(["prefixes-locked"]);
    expect(item.openSuffixes).toBe(0);
    expect(item.openPrefixes).toBe(1);
  });

  it('"Suffixes Cannot Be Changed" and multimod (synthetic): suffixes-locked + multimod', () => {
    const text = replaceOnce(
      glovesWithOpenSlots(),
      "\nSearing Exarch Item",
      '\n{ Master Crafted Suffix Modifier "of Crafting" }\nCan have up to 3 Crafted Modifiers — Unscalable Value\n{ Master Crafted Prefix Modifier "Suffixed" }\nSuffixes Cannot Be Changed — Unscalable Value\nSearing Exarch Item',
    );
    const item = parseItemFromText(text);
    expect(item.metamods.sort()).toEqual(["multimod", "suffixes-locked"]);
    expect(item.mods.filter((m) => m.flags.crafted).map((m) => m.modId)).toEqual([
      "EinharMasterEvasionAndEnergyShieldPercent3",
      "StrIntMasterItemGenerationCanHaveMultipleCraftedMods",
      "DexMasterItemGenerationCannotChangeSuffixes",
    ]);
    expect(item.openPrefixes).toBe(0);
    expect(item.openSuffixes).toBe(0);
  });

  // Format from PathOfBuilding's own parser test data (spec/System/TestItemParse_spec.lua):
  //   { Prefix Modifier "Veiled" }
  //   Veiled Prefix
  // "Veiled" and "of the Veil" are RePoE's names for the veiled-domain placeholder mods.
  it("a still-veiled mod (synthetic, format from PoB's test data): kind veiled, occupies its slot", () => {
    const text = replaceOnce(glovesWithOpenSlots(), "\nSearing Exarch Item", '\n{ Prefix Modifier "Veiled" }\nVeiled Prefix\n{ Suffix Modifier "of the Veil" }\nVeiled Suffix\nSearing Exarch Item');
    const item = parseItemFromText(text);
    const veiled = item.mods.filter((m) => m.kind === "veiled");
    expect(veiled.map((m) => [m.side, m.modId, m.flags.veiled, m.text])).toEqual([
      ["prefix", "VeiledPrefix", true, "Veiled Prefix"],
      ["suffix", "VeiledSuffix", true, "Veiled Suffix"],
    ]);
    expect(item.openPrefixes).toBe(0);
    expect(item.openSuffixes).toBe(0);
  });

  it('a normal item with quality is named "Superior <base>" (synthetic)', () => {
    const text = replaceOnce(fixtureText("normal-wand"), "Kinetic Wand\n--------\nWand\n", "Superior Kinetic Wand\n--------\nWand\nQuality: +20% (augmented)\n");
    const item = parseItemFromText(text);
    expect(item.base.name).toBe("Kinetic Wand");
    expect(item.rarity).toBe("normal");
  });

  it("influence mods stay unresolved but are named (the real Shaper + Elder amulet), and an elevated version is recognised too (synthetic line)", () => {
    const item = parseItemFromText(fixtureText("rare-amulet-shaper-elder-mirrored-quantity"));
    const elder = item.mods.find((m) => m.name === "The Elder's")!;
    expect(elder.kind).toBe("influence");
    expect(elder.modId).toBeNull();
    expect(elder.influences).toEqual(["elder"]);
    expect(elder.candidates).toEqual(["NonChaosAddedAsChaosUber1"]);
    expect(item.warnings.some((w) => /Elder/.test(w))).toBe(false); // recorded, not warned about
    // A Maven-elevated mod: RePoE lists it with its influence tag at weight 0 (only elevating creates
    // it). The gloves version of "of Elevated Redemption" (gloves_eyrie); the helmet version with the
    // same name has different text and is correctly refused on gloves.
    const text = replaceOnce(
      glovesWithOpenSlots(),
      "\nSearing Exarch Item",
      '\n{ Suffix Modifier "of Elevated Redemption" — Attack, Speed }\n+3(2-4)% chance to Evade Attack Hits\n10(7-12)% increased Attack and Cast Speed if you haven\'t been Hit Recently\nSearing Exarch Item',
    );
    const elevated = parseItemFromText(text).mods.find((m) => m.name === "of Elevated Redemption")!;
    expect(elevated.kind).toBe("influence");
    expect(elevated.influences).toEqual(["redeemer"]);
    expect(elevated.candidates).toEqual(["AdditionalChanceToEvadeInfluenceMaven"]);
    const helmetVersion = replaceOnce(glovesWithOpenSlots(), "\nSearing Exarch Item", '\n{ Suffix Modifier "of Elevated Redemption" — Damage, Elemental, Fire, Ailment }\n15(10-15)% chance to Ignite\nIgnites you inflict deal Damage 12(10-15)% faster\nSearing Exarch Item');
    expect(() => parseItemFromText(helmetVersion)).toThrow(UnknownModError);
  });
});
