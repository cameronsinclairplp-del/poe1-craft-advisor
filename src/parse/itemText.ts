// Milestone 3: Ctrl+Alt+C item text -> Item (BRIEF.md §6, §7.3; HANDOVER.md Step A).
//
// Two stages. parseItemText() turns the text into a RawItem without touching any data: sections,
// header, names, item level, requirements, every "{ ... }" block with its stat lines, enchants,
// footers. resolveItem() then needs public/data: the class file for the item's class, index.json
// and other_mods.json.gz. It resolves the base (disambiguating same-name bases by implicit and
// requirements), every explicit mod by name + side + text template + value ranges, in this order:
// veiled placeholders, the class's rollable mods (tier cross-checked against the in-game
// "(Tier: n)"; a mismatch is a warning on the item, the number is informational), bench crafts,
// unveiled mods, influence mods (recorded as unresolved-influence), then the shared list of mods
// nothing in v1 can roll (several equal matches there are narrowed by the base's tags). A name that
// matches nowhere is an UnknownModError naming the line. Nothing is guessed.
//
// Format notes, all taken from real pastes in test/fixtures/items (see the "# source:" line in each):
//   { Prefix Modifier "Virile" (Tier: 2) — Life }                                  ordinary mod
//   { Master Crafted Prefix Modifier "Upgraded" (Rank: 3) — Defences, Evasion }    bench craft; Rank is optional
//   { Fractured Suffix Modifier "of the Rainbow" (Tier: 1) — Elemental, Resistance  — 70% Increased }
//                                       fractured; the "— 70% Increased" note comes from a magnitude implicit
//   { Suffix Modifier "of the Essence" — Attribute }                                 essence mods carry no tier
//   { Prefix Modifier "Veiled" }  /  Veiled Prefix                                   still veiled (PoB TestItemParse_spec)
//   { Implicit Modifier — Damage, Caster } / { Corruption Implicit Modifier } / { Vestigial Implicit Modifier }
//   { Searing Exarch Implicit Modifier (Lesser) — Speed } / { Eater of Worlds Implicit Modifier (Lesser) }
//   { Unique Modifier — Attribute }                                                  uniques
//   Allocates Force of Darkness (enchant)                                            enchants have no header
//   +12(8-12)% to Fire and Cold Resistances (implicit)                               older clients mark lines instead of headers
//   Adds 29(28-38) to 595(549-638) Lightning Damage (fractured)                      idem for fractured / crafted
//   (40% of Damage from Suppressed Hits and Ailments they inflict is prevented)      reminder lines are skipped
//   Cannot roll Attack Modifiers — Unscalable Value                                  stripped, noted
//   Corrupted / Mirrored / Split / Fractured Item / Synthesised Item / Shaper Item   footers, one per line

import { buildPool, resolveWeight } from "../engine/pool.ts";
import type { BaseRecord, DataIndex, LiteModRecord, OtherModsFile, PoolFile, PoolMod } from "../engine/types.ts";
import {
  AmbiguousBaseError,
  AmbiguousModError,
  ParseError,
  UnknownBaseError,
  UnknownModError,
  UnsupportedItemClassError,
  type LineRef,
} from "./errors.ts";
import { isReminderLine, rangesContained, rangesOf, stripTrailers, templateOf, valuesOf, type LineTrailer } from "./text.ts";
import type { Influence, Item, ItemMod, ImplicitMod, Metamod, ModKind, Rarity, Side, TierCheck, UniqueMod } from "./types.ts";

export type { Item, ItemMod, ImplicitMod, UniqueMod, Influence, Metamod, ModKind, Rarity, Side, TierCheck } from "./types.ts";
export * from "./errors.ts";

const SEPARATOR = "--------";

// ---------------------------------------------------------------------------
// Stage 1: text -> RawItem (no data needed)
// ---------------------------------------------------------------------------

interface Line {
  n: number;
  t: string;
}

export interface RawModBlock {
  line: number;
  headerText: string;
  side: Side;
  name: string;
  tier: number | null;
  rank: number | null;
  tags: string[];
  /** "70% Increased" style note printed by magnitude implicits; informational. */
  magnitude: string | null;
  /** From the header word ("Fractured", "Master Crafted", ...) or a line marker. */
  fractured: boolean;
  crafted: boolean;
  /** Header said "Veiled"/"Unveiled" (not seen in the wild; the veiled case uses the name "Veiled"). */
  veiledHeader: boolean;
  unveiledHeader: boolean;
  /** Stat lines with markers and reminder lines removed. */
  lines: string[];
  trailers: Set<LineTrailer>;
}

export interface RawImplicitBlock {
  line: number;
  kind: ImplicitMod["kind"];
  source?: "searing-exarch" | "eater-of-worlds";
  eldritchTier?: string;
  variant?: string;
  tags: string[];
  lines: string[];
}

export interface RawUniqueBlock {
  line: number;
  tags: string[];
  lines: string[];
}

export interface RawItem {
  itemClassName: string;
  itemClassLine: LineRef;
  rarity: Rarity;
  /** Rare / unique name line; null for normal and magic. */
  nameLine: string | null;
  /** Rare / unique: the base line. Normal / magic: the whole item name line. */
  baseLine: LineRef;
  ilvl: number | null;
  requirements: { level?: number; str?: number; dex?: number; int?: number };
  explicit: RawModBlock[];
  implicits: RawImplicitBlock[];
  enchants: { line: number; text: string }[];
  uniqueMods: RawUniqueBlock[];
  /** Footer lines as printed ("Corrupted", "Shaper Item", ...). */
  footers: string[];
  warnings: string[];
}

interface Header {
  kind: string;
  name: string | null;
  tierKind: "Tier" | "Rank" | null;
  tierValue: number | null;
  eldritchTier: string | null;
  tags: string[];
  magnitude: string | null;
}

/** Parse the inside of "{ ... }". */
function parseHeader(inner: string, where: LineRef): Header {
  // Parts are separated by an em dash. The magnitude note is a trailing "— 70% Increased".
  const parts = inner.split(/\s+—\s+/);
  let head = (parts[0] ?? "").trim();
  const tags: string[] = [];
  let magnitude: string | null = null;
  for (const part of parts.slice(1)) {
    const s = part.trim();
    if (/^\d+% (Increased|Reduced)$/.test(s)) magnitude = s;
    else if (s) tags.push(...s.split(",").map((t) => t.trim()).filter(Boolean));
  }
  let eldritchTier: string | null = null;
  const em = / \((Lesser|Greater|Grand|Exceptional|Exquisite|Perfect)\)$/.exec(head);
  if (em) {
    eldritchTier = em[1] ?? null;
    head = head.slice(0, em.index);
  }
  let tierKind: Header["tierKind"] = null;
  let tierValue: number | null = null;
  const tm = / \((Tier|Rank): (\d+)\)$/.exec(head);
  if (tm) {
    tierKind = tm[1] as "Tier" | "Rank";
    tierValue = Number(tm[2]);
    head = head.slice(0, tm.index);
  }
  let name: string | null = null;
  const nm = / "([^"]*)"$/.exec(head);
  if (nm) {
    name = nm[1] ?? "";
    head = head.slice(0, nm.index);
  }
  const kind = head.trim();
  if (!kind) throw new ParseError("bad-header", "modifier header has no kind", where);
  return { kind, name, tierKind, tierValue, eldritchTier, tags, magnitude };
}

const EXPLICIT_KIND_RE = /^(?:(Fractured|Master Crafted|Veiled|Unveiled) )?(Prefix|Suffix) Modifier$/;
const IMPLICIT_KIND_RE = /^(?:(.+) )?Implicit Modifier$/;

const FOOTER_RE = /^(Corrupted|Mirrored|Split|Unidentified|Fractured Item|Synthesised Item|Scourged|Hinekora's Lock|(?:Shaper|Elder|Crusader|Hunter|Redeemer|Warlord|Searing Exarch|Eater of Worlds) Item)$/;
const PROPERTY_RE = /^[^:{}]+: /;

const RARITIES: Record<string, Rarity> = { Normal: "normal", Magic: "magic", Rare: "rare", Unique: "unique" };

/** Structure only: no data, so it never throws for an unknown base or mod. */
export function parseItemText(text: string): RawItem {
  const all: Line[] = text.split(/\r?\n/).map((t, i) => ({ n: i + 1, t: t.replace(/\s+$/, "") }));
  // Leading "#" lines are comments (fixture provenance); blank lines never mean anything.
  let start = 0;
  while (start < all.length && (all[start]!.t === "" || all[start]!.t.startsWith("#"))) start++;
  const lines = all.slice(start).filter((l) => l.t !== "");
  if (lines.length === 0) throw new ParseError("empty", "nothing to parse");

  const sections: Line[][] = [[]];
  for (const l of lines) {
    if (l.t === SEPARATOR) sections.push([]);
    else sections[sections.length - 1]!.push(l);
  }

  // Header section: Item Class, Rarity, then one name line (normal, magic) or two (rare, unique).
  const head = sections[0]!;
  const classLine = head[0];
  const classMatch = classLine ? /^Item Class: (.+)$/.exec(classLine.t) : null;
  if (!classLine || !classMatch) {
    throw new ParseError("no-item-class", 'expected the first line to be "Item Class: ..." (copy the item with Ctrl+Alt+C in a current client)', classLine ? ref(classLine) : undefined);
  }
  const rarityLine = head[1];
  const rarityMatch = rarityLine ? /^Rarity: (.+)$/.exec(rarityLine.t) : null;
  if (!rarityLine || !rarityMatch) throw new ParseError("malformed", 'expected the second line to be "Rarity: ..."', rarityLine ? ref(rarityLine) : undefined);
  const rarity = RARITIES[rarityMatch[1]!.trim()];
  if (!rarity) throw new ParseError("unsupported-rarity", `rarity "${rarityMatch[1]}" is not an equipment rarity`, ref(rarityLine));
  if (lines.some((l) => l.t === "Unidentified")) {
    throw new ParseError("unidentified", "the item is unidentified; identify it first", ref(lines.find((l) => l.t === "Unidentified")!));
  }
  const names = head.slice(2);
  const wantNames = rarity === "rare" || rarity === "unique" ? 2 : 1;
  if (names.length !== wantNames) {
    throw new ParseError(
      "malformed",
      `a ${rarity} item should have ${wantNames} name line${wantNames > 1 ? "s" : ""} after "Rarity:", found ${names.length}`,
      names[0] ? ref(names[0]) : ref(rarityLine),
    );
  }
  const raw: RawItem = {
    itemClassName: classMatch[1]!.trim(),
    itemClassLine: ref(classLine),
    rarity,
    nameLine: wantNames === 2 ? names[0]!.t : null,
    baseLine: ref(names[wantNames - 1]!),
    ilvl: null,
    requirements: {},
    explicit: [],
    implicits: [],
    enchants: [],
    uniqueMods: [],
    footers: [],
    warnings: [],
  };

  for (const section of sections.slice(1)) parseSection(section, raw);
  return raw;
}

function ref(l: Line): LineRef {
  return { line: l.n, text: l.t };
}

function parseSection(section: readonly Line[], raw: RawItem): void {
  const hasProperty = section.some((l) => PROPERTY_RE.test(l.t) && !/^Item Level: /.test(l.t));
  let inRequirements = false;
  let crucibleNoted = false;
  let i = 0;
  while (i < section.length) {
    const l = section[i]!;
    const t = l.t;
    if (t.startsWith("{ ") && t.endsWith(" }")) {
      const header = parseHeader(t.slice(2, -2), ref(l));
      // Stat lines: up to the next header or the end of the section.
      const body: Line[] = [];
      let j = i + 1;
      while (j < section.length && !(section[j]!.t.startsWith("{ ") && section[j]!.t.endsWith(" }"))) {
        body.push(section[j]!);
        j++;
      }
      i = j;
      const trailers = new Set<LineTrailer>();
      const statLines: string[] = [];
      const footersInBody: Line[] = [];
      for (const b of body) {
        const { text: clean, trailers: tr } = stripTrailers(b.t);
        if (isReminderLine(clean)) continue;
        if (FOOTER_RE.test(clean)) {
          // Some clients print footers straight after the last mod without a separator.
          footersInBody.push(b);
          continue;
        }
        for (const x of tr) trailers.add(x);
        statLines.push(clean);
      }
      dispatchHeader(header, statLines, trailers, l, raw);
      for (const f of footersInBody) raw.footers.push(f.t);
      continue;
    }
    i++;
    const { text: clean, trailers } = stripTrailers(t);
    const ilvl = /^Item Level: (\d+)$/.exec(t);
    if (ilvl) {
      raw.ilvl = Number(ilvl[1]);
      continue;
    }
    if (t === "Requirements:") {
      inRequirements = true;
      continue;
    }
    const req = inRequirements ? /^(Level|Str|Dex|Int): (\d+)/.exec(t) : null;
    if (req) {
      const key = ({ Level: "level", Str: "str", Dex: "dex", Int: "int" } as const)[req[1] as "Level" | "Str" | "Dex" | "Int"];
      raw.requirements[key] = Number(req[2]);
      continue;
    }
    if (trailers.has("enchant")) {
      if (!isReminderLine(clean)) raw.enchants.push({ line: l.n, text: clean });
      continue;
    }
    if (trailers.has("implicit")) {
      if (!isReminderLine(clean)) raw.implicits.push({ line: l.n, kind: "implicit", tags: [], lines: [clean] });
      continue;
    }
    if (trailers.has("scourge")) {
      if (!raw.warnings.some((w) => w.startsWith("scourge"))) raw.warnings.push(`scourge mods ignored (line ${l.n})`);
      continue;
    }
    if (FOOTER_RE.test(t)) {
      raw.footers.push(t);
      continue;
    }
    if (t.startsWith("Note: ") || t.startsWith("Sockets: ")) continue;
    if (t.startsWith("{ Allocated Crucible")) {
      if (!crucibleNoted) raw.warnings.push(`Crucible passives ignored (line ${l.n})`);
      crucibleNoted = true;
      continue;
    }
    if (hasProperty && (PROPERTY_RE.test(t) || !t.includes(":"))) continue; // properties and the weapon type label
    if (isReminderLine(clean)) continue;
    raw.warnings.push(`unrecognised line ${l.n}: ${JSON.stringify(t)}`);
  }
}

function dispatchHeader(header: Header, statLines: string[], trailers: Set<LineTrailer>, at: Line, raw: RawItem): void {
  const explicit = EXPLICIT_KIND_RE.exec(header.kind);
  if (explicit) {
    const word = explicit[1] ?? null;
    if (header.name === null) throw new ParseError("bad-header", "prefix/suffix header has no name", ref(at));
    raw.explicit.push({
      line: at.n,
      headerText: at.t,
      side: explicit[2] === "Prefix" ? "prefix" : "suffix",
      name: header.name,
      tier: header.tierKind === "Tier" ? header.tierValue : null,
      rank: header.tierKind === "Rank" ? header.tierValue : null,
      tags: header.tags,
      magnitude: header.magnitude,
      fractured: word === "Fractured" || trailers.has("fractured"),
      crafted: word === "Master Crafted" || trailers.has("crafted"),
      veiledHeader: word === "Veiled",
      unveiledHeader: word === "Unveiled",
      lines: statLines,
      trailers,
    });
    return;
  }
  const implicit = IMPLICIT_KIND_RE.exec(header.kind);
  if (implicit) {
    const words = implicit[1] ?? "";
    const block: RawImplicitBlock = { line: at.n, kind: "implicit", tags: header.tags, lines: statLines };
    if (words === "") block.kind = "implicit";
    else if (words === "Corruption") block.kind = "corrupted";
    else if (words === "Vestigial") block.kind = "vestigial";
    else if (words === "Searing Exarch" || words === "Eater of Worlds") {
      block.kind = "eldritch";
      block.source = words === "Searing Exarch" ? "searing-exarch" : "eater-of-worlds";
      if (header.eldritchTier) block.eldritchTier = header.eldritchTier;
    } else {
      block.variant = words;
      raw.warnings.push(`implicit header kind "${header.kind}" not recognised, kept as an implicit (line ${at.n})`);
    }
    raw.implicits.push(block);
    return;
  }
  if (header.kind === "Unique Modifier") {
    raw.uniqueMods.push({ line: at.n, tags: header.tags, lines: statLines });
    return;
  }
  if (header.kind === "Allocated Crucible Passive Skill") {
    if (!raw.warnings.some((w) => w.startsWith("Crucible"))) raw.warnings.push(`Crucible passives ignored (line ${at.n})`);
    return;
  }
  if (/Enchant/.test(header.kind)) {
    for (const s of statLines) raw.enchants.push({ line: at.n, text: s });
    return;
  }
  throw new ParseError("bad-header", `unrecognised modifier header kind "${header.kind}"`, ref(at));
}

// ---------------------------------------------------------------------------
// Stage 2: RawItem + data -> Item
// ---------------------------------------------------------------------------

export interface ParseData {
  index: DataIndex;
  /** The class file of the pasted item's class (detectItemClass() says which). */
  classFile: PoolFile;
  otherMods: OtherModsFile;
}

export interface DetectedClass {
  itemClassName: string;
  itemClass: string;
  file: string;
}

/** Read the "Item Class:" line and map it to a class file. Throws UnsupportedItemClassError for jewels, flasks, maps, ... */
export function detectItemClass(text: string, index: DataIndex): DetectedClass {
  const lines = text.split(/\r?\n/).map((t) => t.replace(/\s+$/, ""));
  let n = 0;
  while (n < lines.length && (lines[n] === "" || lines[n]!.startsWith("#"))) n++;
  const first = lines[n];
  const m = first ? /^Item Class: (.+)$/.exec(first) : null;
  if (!first || !m) throw new ParseError("no-item-class", 'expected the first line to be "Item Class: ..."', first ? { line: n + 1, text: first } : undefined);
  const itemClassName = m[1]!.trim();
  const cls = index.classes.find((c) => c.name === itemClassName);
  if (!cls) {
    throw new UnsupportedItemClassError(
      itemClassName,
      index.classes.map((c) => c.name),
      { line: n + 1, text: first },
    );
  }
  return { itemClassName, itemClass: cls.item_class, file: cls.file };
}

/** parseItemText + resolveItem. */
export function parseItem(text: string, data: ParseData): Item {
  return resolveItem(parseItemText(text), data);
}

const INFLUENCE_FOOTERS: Record<string, Influence> = {
  "Shaper Item": "shaper",
  "Elder Item": "elder",
  "Crusader Item": "crusader",
  "Hunter Item": "hunter",
  "Redeemer Item": "redeemer",
  "Warlord Item": "warlord",
  "Searing Exarch Item": "searing-exarch",
  "Eater of Worlds Item": "eater-of-worlds",
};

/** groups[0] of the five bench metamods (crafting_bench_options.json / mods.json). */
const METAMOD_GROUPS: Record<string, Metamod> = {
  ItemGenerationCannotChangePrefixes: "prefixes-locked",
  ItemGenerationCannotChangeSuffixes: "suffixes-locked",
  ItemGenerationCannotRollAttackAffixes: "no-attack-mods",
  ItemGenerationCannotRollCasterAffixes: "no-caster-mods",
  ItemGenerationCanHaveMultipleCraftedMods: "multimod",
};

/** Affix slots per side by rarity: normal none, magic one, rare three, unique not applicable. */
const SLOTS_PER_SIDE: Record<Rarity, number> = { normal: 0, magic: 1, rare: 3, unique: 0 };

export function resolveItem(raw: RawItem, data: ParseData): Item {
  const { index, classFile, otherMods } = data;
  const cls = index.classes.find((c) => c.name === raw.itemClassName);
  if (!cls) throw new UnsupportedItemClassError(raw.itemClassName, index.classes.map((c) => c.name), raw.itemClassLine);
  if (classFile.item_class !== cls.item_class) {
    throw new Error(`resolveItem: the item is a ${cls.item_class} but the class file given is ${classFile.item_class}`);
  }
  if (raw.ilvl === null) throw new ParseError("malformed", 'no "Item Level:" line');
  const warnings = [...raw.warnings];

  // Footers -> flags.
  const influences: Influence[] = [];
  let corrupted = false;
  let mirrored = false;
  let split = false;
  let synthesisedFooter = false;
  let fracturedItem = false;
  for (const f of raw.footers) {
    const inf = INFLUENCE_FOOTERS[f];
    if (inf) {
      if (!influences.includes(inf)) influences.push(inf);
    } else if (f === "Corrupted") corrupted = true;
    else if (f === "Mirrored") mirrored = true;
    else if (f === "Split") split = true;
    else if (f === "Synthesised Item") synthesisedFooter = true;
    else if (f === "Fractured Item") fracturedItem = true;
    else warnings.push(`footer "${f}" noted but not modelled`);
  }

  // Base.
  const { base, synthesised, vestigial } = resolveBase(raw, cls.item_class, index, classFile, warnings);
  if (synthesised && !synthesisedFooter) warnings.push('base name says Synthesised but there is no "Synthesised Item" footer');
  if (!synthesised && synthesisedFooter) warnings.push('"Synthesised Item" footer without a Synthesised base name');
  const vestigialImplicit = raw.implicits.some((b) => b.kind === "vestigial");
  if (vestigial !== vestigialImplicit) warnings.push(`Vestigial base name (${vestigial}) and Vestigial implicit (${vestigialImplicit}) disagree`);

  // Implicits, enchants.
  const implicits: ImplicitMod[] = [];
  const eldritchImplicits: ImplicitMod[] = [];
  for (const b of raw.implicits) {
    const mod: ImplicitMod = { kind: b.kind, text: b.lines.join("\n"), lines: b.lines, tags: b.tags, line: b.line };
    if (b.source) mod.source = b.source;
    if (b.eldritchTier) mod.eldritchTier = b.eldritchTier;
    if (b.variant) mod.variant = b.variant;
    (b.kind === "eldritch" ? eldritchImplicits : implicits).push(mod);
  }
  const enchants: ImplicitMod[] = raw.enchants.map((e) => ({ kind: "enchant", text: e.text, lines: [e.text], tags: [], line: e.line }));
  const uniqueMods: UniqueMod[] = raw.uniqueMods.map((u) => ({ text: u.lines.join("\n"), lines: u.lines, tags: u.tags, line: u.line }));

  // Explicit mods.
  const resolver = raw.rarity === "unique" ? null : new ModResolver(classFile, base, otherMods, warnings);
  const mods: ItemMod[] = raw.explicit.map((block) => (resolver ? resolver.resolve(block) : uniqueItemMod(block)));

  // Slots. The base's own implicits can shift them (Helical Ring: -2 prefixes, +1 suffix; Simplex
  // Amulet: -2 / -1), read from the implicit's stats, and only when that implicit is on the item.
  let maxPrefixes = SLOTS_PER_SIDE[raw.rarity];
  let maxSuffixes = SLOTS_PER_SIDE[raw.rarity];
  if (raw.rarity === "magic" || raw.rarity === "rare") {
    const pasteImplicitTemplates = new Set(implicits.filter((m) => m.kind === "implicit").flatMap((m) => m.lines.map(templateOf)));
    for (const id of base.implicits) {
      const imp = classFile.implicit_mods[id];
      if (!imp) continue;
      const present = imp.text.split("\n").some((l) => pasteImplicitTemplates.has(templateOf(l)));
      if (!present) continue;
      for (const s of imp.stats) {
        if (s.id === "local_maximum_prefixes_allowed_+") maxPrefixes += s.min;
        else if (s.id === "local_maximum_suffixes_allowed_+") maxSuffixes += s.min;
      }
    }
    maxPrefixes = Math.max(0, maxPrefixes);
    maxSuffixes = Math.max(0, maxSuffixes);
  }
  const usedPrefixes = mods.filter((m) => m.side === "prefix").length;
  const usedSuffixes = mods.filter((m) => m.side === "suffix").length;
  if (raw.rarity !== "unique") {
    if (usedPrefixes > maxPrefixes) warnings.push(`${usedPrefixes} prefixes on an item that allows ${maxPrefixes}`);
    if (usedSuffixes > maxSuffixes) warnings.push(`${usedSuffixes} suffixes on an item that allows ${maxSuffixes}`);
  }
  const hasFracturedMod = mods.some((m) => m.flags.fractured);
  if (fracturedItem && !hasFracturedMod) warnings.push('"Fractured Item" footer but no fractured mod');
  if (!fracturedItem && hasFracturedMod) warnings.push('a fractured mod but no "Fractured Item" footer');

  const metamods: Metamod[] = [];
  for (const m of mods) {
    if (m.kind !== "crafted" || !m.modId) continue;
    const rec = classFile.crafted_mods.find((c) => c.id === m.modId);
    const key = rec?.groups[0];
    const meta = key ? METAMOD_GROUPS[key] : undefined;
    if (meta && !metamods.includes(meta)) metamods.push(meta);
  }

  return {
    itemClass: cls.item_class,
    itemClassName: raw.itemClassName,
    base: { id: base.id, name: base.name },
    name: raw.nameLine,
    rarity: raw.rarity,
    ilvl: raw.ilvl,
    influences,
    corrupted,
    mirrored,
    split,
    synthesised: synthesised || synthesisedFooter,
    vestigial,
    fracturedItem,
    mods,
    implicits,
    enchants,
    eldritchImplicits,
    uniqueMods,
    maxPrefixes,
    maxSuffixes,
    openPrefixes: Math.max(0, maxPrefixes - usedPrefixes),
    openSuffixes: Math.max(0, maxSuffixes - usedSuffixes),
    metamods,
    warnings,
  };
}

function uniqueItemMod(block: RawModBlock): ItemMod {
  return {
    side: block.side,
    name: block.name,
    tier: block.tier,
    rank: block.rank,
    text: block.lines.join("\n"),
    lines: block.lines,
    tags: block.tags,
    modId: null,
    kind: "unique",
    flags: { crafted: block.crafted, fractured: block.fractured, veiled: block.veiledHeader, unveiled: block.unveiledHeader },
    ourTier: null,
    tierCheck: "no-ladder",
    line: block.line,
  };
}

// ---------------------------------------------------------------------------
// Base resolution
// ---------------------------------------------------------------------------

interface ResolvedBase {
  base: BaseRecord;
  synthesised: boolean;
  vestigial: boolean;
}

function resolveBase(raw: RawItem, itemClass: string, index: DataIndex, classFile: PoolFile, warnings: string[]): ResolvedBase {
  const where = raw.baseLine;
  let name = where.text.trim();
  // Magic items print "<prefix name> <base> of <suffix name>"; the headers give the affix names.
  if (raw.rarity === "magic") {
    for (const b of raw.explicit) {
      if (b.side === "prefix" && name.startsWith(`${b.name} `)) name = name.slice(b.name.length + 1);
      if (b.side === "suffix" && name.endsWith(` ${b.name}`)) name = name.slice(0, -(b.name.length + 1));
    }
  }
  const byName = (n: string): BaseRecord[] => {
    const ids = new Set(index.bases.filter((b) => b.item_class === itemClass && b.name === n).map((b) => b.id));
    return classFile.bases.filter((b) => ids.has(b.id));
  };
  let synthesised = false;
  let vestigial = false;
  let candidates = byName(name);
  // Display prefixes: "Superior" (quality on a normal item), "Synthesised", "Vestigial" (3.29).
  const prefixes: [RegExp, () => void][] = [
    [/^Superior /, () => undefined],
    [/^Synthesised /, () => (synthesised = true)],
    [/^Vestigial /, () => (vestigial = true)],
  ];
  let progress = true;
  while (candidates.length === 0 && progress) {
    progress = false;
    for (const [re, mark] of prefixes) {
      if (re.test(name)) {
        name = name.replace(re, "");
        mark();
        candidates = byName(name);
        progress = true;
        break;
      }
    }
  }
  if (candidates.length === 0) throw new UnknownBaseError(name, itemClass, where);

  if (candidates.length > 1) {
    // Same name, different base: Two-Stone Ring x3, Two-Toned Boots x3, talismans, legacy quivers.
    // The base implicit tells them apart, unless a corruption replaced it; then the attribute
    // requirements may; otherwise nobody can, and saying so beats picking one.
    const pasteImplicits = new Set(raw.implicits.filter((b) => b.kind === "implicit").flatMap((b) => b.lines.map(templateOf)));
    if (pasteImplicits.size > 0) {
      const matching = candidates.filter((b) =>
        b.implicits.length > 0 &&
        b.implicits.every((id) => {
          const imp = classFile.implicit_mods[id];
          return imp !== undefined && imp.text.split("\n").every((l) => pasteImplicits.has(templateOf(l)));
        }),
      );
      if (matching.length > 0) candidates = matching;
    }
    if (candidates.length > 1) {
      const req = raw.requirements;
      const matching = candidates.filter((b) => {
        const r = b.requirements;
        if (!r) return false;
        return (req.str ?? 0) === r.strength && (req.dex ?? 0) === r.dexterity && (req.int ?? 0) === r.intelligence;
      });
      if (matching.length > 0) candidates = matching;
    }
    if (candidates.length > 1) {
      throw new AmbiguousBaseError(
        name,
        candidates.map((b) => b.id),
        raw.implicits.some((b) => b.kind === "corrupted")
          ? "the corruption replaced the implicit that would tell them apart"
          : "neither the implicit nor the requirements tell them apart",
        where,
      );
    }
    warnings.push(`base name "${name}" is shared by several bases; chose ${candidates[0]!.id} by ${pasteImplicits.size > 0 ? "implicit" : "requirements"}`);
  }
  return { base: candidates[0]!, synthesised, vestigial };
}

// ---------------------------------------------------------------------------
// Mod resolution
// ---------------------------------------------------------------------------

interface Match<T extends LiteModRecord> {
  byName: T[];
  byText: T[];
  byRange: T[];
}

class ModResolver {
  private readonly poolById = new Map<string, PoolMod>();
  private readonly baseTags: Set<string>;

  constructor(
    private readonly classFile: PoolFile,
    private readonly base: BaseRecord,
    private readonly otherMods: OtherModsFile,
    private readonly warnings: string[],
  ) {
    // ilvl 100 puts every mod that can roll on this base in the pool; tiers do not depend on it.
    for (const p of buildPool(classFile, base, 100).pool) this.poolById.set(p.id, p);
    this.baseTags = new Set(base.tags);
  }

  resolve(block: RawModBlock): ItemMod {
    const where: LineRef = { line: block.line, text: block.headerText };
    const template = templateOf(block.lines.join("\n"));
    const ranges = block.lines.flatMap(rangesOf);
    const nearMisses: string[] = [];
    const match = <T extends LiteModRecord>(list: readonly T[]): Match<T> => {
      const byName = list.filter((m) => m.name === block.name && m.side === block.side);
      const byText = byName.filter((m) => templateOf(m.text) === template);
      const byRange = byText.filter((m) => rangesContained(ranges, valuesOf(m.text)));
      for (const m of byName) if (!byRange.includes(m)) nearMisses.push(`${m.id}: ${m.text.replace(/\n/g, " / ")}`);
      return { byName, byText, byRange };
    };
    const one = <T extends LiteModRecord>(m: Match<T>): T | null => {
      if (m.byRange.length === 1) return m.byRange[0]!;
      if (m.byRange.length > 1) throw new AmbiguousModError(block.name, block.side, m.byRange.map((x) => x.id), where);
      return null;
    };
    const common = {
      side: block.side,
      name: block.name,
      tier: block.tier,
      rank: block.rank,
      text: block.lines.join("\n"),
      lines: block.lines,
      tags: block.tags,
      line: block.line,
    };
    const flags = (over: Partial<ItemMod["flags"]> = {}): ItemMod["flags"] => ({
      crafted: block.crafted,
      fractured: block.fractured,
      veiled: block.veiledHeader,
      unveiled: block.unveiledHeader,
      ...over,
    });

    // 1. Still veiled: "{ Prefix Modifier "Veiled" }" over the line "Veiled Prefix".
    const veiled = this.classFile.veiled_mods.find((v) => v.name === block.name && v.side === block.side);
    if (veiled) {
      return { ...common, modId: veiled.id, kind: "veiled", flags: flags({ veiled: true }), ourTier: null, tierCheck: "no-ladder" };
    }

    // 2. The class's rollable mods: the only ones with a tier ladder to compare against. The
    //    in-game "(Tier: n)" is informational: the mod is already resolved by name, side, text and
    //    ranges, so a different number is a warning (tierCheck "mismatch"), never an error.
    const pool = one(match(this.classFile.mods));
    if (pool) {
      const p = this.poolById.get(pool.id);
      let tierCheck: TierCheck = "no-ladder";
      let ourTier: number | null = null;
      if (!p) {
        this.warnings.push(`${block.side} "${block.name}" (${pool.id}) cannot roll on ${this.base.name}; tier not checked (line ${block.line})`);
      } else {
        ourTier = p.tier;
        if (block.tier === null) tierCheck = "no-game-tier";
        else if (ourTier === null) tierCheck = "no-ladder";
        else if (ourTier === block.tier) tierCheck = "ok";
        else {
          tierCheck = "mismatch";
          this.warnings.push(this.tierMismatchWarning(block, p));
        }
      }
      return { ...common, modId: pool.id, kind: "pool", flags: flags(), ourTier, tierCheck };
    }

    // 3. Bench crafts.
    const crafted = one(match(this.classFile.crafted_mods));
    if (crafted) {
      if (block.rank !== null && block.rank !== crafted.bench_tier) {
        this.warnings.push(`${block.side} "${block.name}" (${crafted.id}): the game says Rank ${block.rank}, bench_tier is ${crafted.bench_tier} (line ${block.line})`);
      }
      if (!block.crafted) this.warnings.push(`${block.side} "${block.name}" resolved to bench craft ${crafted.id} but the header did not say Master Crafted (line ${block.line})`);
      return { ...common, modId: crafted.id, kind: "crafted", flags: flags({ crafted: true }), ourTier: null, tierCheck: "no-ladder" };
    }

    // 4. Unveiled mods that can be unveiled on this base's tags.
    const unveiled = one(match(this.classFile.unveiled_mods.filter((m) => resolveWeight(m.spawn_weights, this.baseTags) > 0)));
    if (unveiled) {
      return { ...common, modId: unveiled.id, kind: "unveiled", flags: flags({ unveiled: true }), ourTier: null, tierCheck: "no-ladder" };
    }

    // 5. Influence-gated mods: recorded, not resolved (STATUS.md VERIFY 9). Several may match the
    // same text (an ordinary and an elevated version), so this is the one stage that accepts >1.
    const influence = match(this.classFile.influence_mods);
    if (influence.byRange.length > 0) {
      const infl = [...new Set(influence.byRange.flatMap((m) => m.influences))] as Influence[];
      return {
        ...common,
        modId: null,
        kind: "influence",
        flags: flags(),
        ourTier: null,
        tierCheck: "no-ladder",
        influences: infl,
        candidates: influence.byRange.map((m) => m.id),
      };
    }

    // 6. Known to RePoE, rollable by nothing v1 models. Every Delve mod is named "Subterranean" /
    //    "of the Underground" and some texts recur across item classes (177 (name, side, text) keys
    //    are shared in other_mods today, mostly Incursion's level-50 twins), so when several match
    //    equally the ones with a positive spawn weight on one of this base's tags are preferred.
    //    Still several after that: AmbiguousModError, never a guess.
    const otherMatch = match(this.otherMods.mods);
    if (otherMatch.byRange.length > 1) {
      const onBase = otherMatch.byRange.filter((m) => m.tags.some((t) => this.baseTags.has(t)));
      if (onBase.length > 0) otherMatch.byRange = onBase;
    }
    const other = one(otherMatch);
    if (other) {
      this.warnings.push(`${block.side} "${block.name}" is ${other.id} (${other.domain} domain): on the item, occupies its slot, but no v1 action can roll it (line ${block.line})`);
      return { ...common, modId: other.id, kind: "other", flags: flags(), ourTier: null, tierCheck: "no-ladder", domain: other.domain };
    }

    throw new UnknownModError(block.name, block.side, [...new Set(nearMisses)], where);
  }

  /** The (group, side, type) ladder the mod sits in, best first, so the warning shows what the engine compared against. */
  private tierMismatchWarning(block: RawModBlock, p: PoolMod): string {
    const ladder = [...this.poolById.values()]
      .filter((x) => x.group === p.group && x.side === p.side && x.type === p.type && !x.essenceOnly)
      .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || b.level - a.level)
      .map((x) => `T${x.tier ?? "?"} L${x.level} ${x.id} "${x.text}"`);
    return (
      `${block.side} "${block.name}" (${p.id}): the game says Tier ${block.tier}, the engine's ladder ${p.group}|${p.side}|${p.type} says T${p.tier}; ` +
      `resolved by name, side and text, the number is informational. Ladder: ${ladder.join("; ")} (line ${block.line})`
    );
  }
}

/** The kinds a resolved explicit mod can have, for callers that want to branch on them. */
export const MOD_KINDS: readonly ModKind[] = ["pool", "crafted", "unveiled", "veiled", "influence", "other", "unique"];
