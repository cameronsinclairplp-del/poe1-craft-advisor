// Data contract between scripts/build-data.ts (producer) and src/engine (consumer).
//
// One PoolFile per RePoE item class, written gzipped to public/data/<Item_Class>.json.gz
// (spaces in the class name become underscores, e.g. "Body Armour" -> Body_Armour.json.gz).
// public/data/index.json lists every class file and every base so the UI can find the
// right file for a pasted item without loading them all.
//
// Everything here is copied from the RePoE fork verbatim except where a comment says
// otherwise. Nothing is invented: if a fact is not in RePoE it is not in this file.

export interface TagWeight {
  tag: string;
  weight: number;
}

export interface StatRange {
  id: string;
  min: number;
  max: number;
}

/** An explicit prefix/suffix mod from mods.json (domain "item"). */
export interface ModRecord {
  /** RePoE mod id (the mods.json key). Mod identity everywhere in this project. */
  id: string;
  /** Affix name, e.g. "Prime". */
  name: string;
  /** Full stat text. Hybrid mods have several lines separated by "\n"; the engine shows the first. */
  text: string;
  side: "prefix" | "suffix";
  /** RePoE groups. Group identity is groups[0] (CLAUDE.md conventions). Never empty in current data. */
  groups: string[];
  /** RePoE type: the stat family. Part of the tier ladder key (group, side, type). */
  type: string;
  required_level: number;
  is_essence_only: boolean;
  /** ORDERED. The first entry whose tag the item carries wins; no match means weight 0. */
  spawn_weights: TagWeight[];
  /** ORDERED percentage multipliers with the same first-match rule; no match means x1. */
  generation_weights: TagWeight[];
  /** Tags the mod adds to the item once placed; they change the weights of later draws. */
  adds_tags: string[];
  implicit_tags: string[];
  stats: StatRange[];
}

export interface BaseRecord {
  /** RePoE base id (the base_items.json key), e.g. "Metadata/Items/Armours/BodyArmours/BodyStr15". */
  id: string;
  name: string;
  item_class: string;
  tags: string[];
  drop_level: number;
  implicits: string[];
  /** Copied verbatim; null where RePoE has none (every released Ring, Amulet, Belt and Quiver base). */
  requirements: { level: number; strength: number; dexterity: number; intelligence: number } | null;
  /** Index into PoolFile.tag_sets for this base's tag array. */
  tag_set: number;
}

/**
 * Pre-resolved weights and tier ladders for one distinct tag array shared by one or more bases
 * of the class. The engine re-derives the same numbers at runtime from ModRecord (so influence
 * tags can be added later); build-data asserts both agree.
 */
export interface TagSetRecord {
  tags: string[];
  base_ids: string[];
  /**
   * Per PoolFile.mods index: spawn weight x generation multiplier for these tags. 0 = cannot roll
   * (always 0 for essence-only mods). May be fractional: generation_weights are percentages, so
   * e.g. 1000 x 87.5% = 875 and 1000 x 1.25% = 12.5.
   */
  weights: number[];
  /**
   * "group|side|type" -> mods indices with weight > 0, best first (highest required_level, stable
   * in mods order for equal levels). A mod's tier is 1 + its position in this ladder whatever the
   * item level; at item level L only the entries with required_level <= L are in the pool. The
   * RePoE `type` is part of the key so families that share a group but not a stat (the elemental
   * gem-level prefixes, flat armour vs flat energy shield) are tiered apart, as the game does.
   * Essence-only mods are not in these ladders; they get a value-based tier at runtime (see
   * pool.ts buildPool).
   */
  tiers: Record<string, number[]>;
}

export interface EssenceRecord {
  /** RePoE essence id (essences.json key). */
  id: string;
  name: string;
  /** RePoE "level": 1 (Whispering) .. 7 (Deafening), 8 for the corruption-only four, 0 for Remnant of Corruption / Desolation. */
  level: number;
  /** RePoE type.tier. */
  tier: number;
  is_corruption_only: boolean;
  item_level_restriction: number | null;
  spawn_level_min: number;
  /** The mod this essence forces on this item class (essences.json mods[item_class]). */
  mod_id: string;
}

export interface BenchActions {
  change_socket_count: number | null;
  link_sockets: number | null;
  color_sockets: string | null;
  add_explicit_mod: string | null;
  remove_crafted_mods: boolean | null;
  add_enchant_mod: string | null;
  remove_enchantments: boolean | null;
  reroll_rarity: boolean | null;
  reroll_rare_mods: number | null;
}

export interface BenchRecord {
  master: string;
  bench_tier: number;
  /** Currency base id -> count, e.g. { "Metadata/Items/Currency/CurrencyRerollRare": 3 }. */
  cost: Record<string, number>;
  actions: BenchActions;
  item_classes: string[];
}

export interface FossilRecord {
  /** RePoE fossil id (fossils.json key). */
  id: string;
  name: string;
  added_mods: string[];
  forced_mods: string[];
  sell_price_mods: string[];
  positive_mod_weights: TagWeight[];
  negative_mod_weights: TagWeight[];
  forbidden_tags: string[];
  allowed_tags: string[];
  rolls_lucky: boolean;
  rolls_white_sockets: boolean;
  mirrors: boolean;
  changes_quality: boolean;
  corrupted_essence_chance: number;
  descriptions: Record<string, string>;
  blocked_descriptions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Lists the milestone 3 parser matches by name and text (never rolled by the engine)
// ---------------------------------------------------------------------------

/** A mod copied from mods.json without its weights: enough to recognise it on a pasted item. */
export interface LiteModRecord {
  id: string;
  name: string;
  /** Full stat text; hybrid mods have several lines separated by "\n". "" where RePoE has null. */
  text: string;
  side: "prefix" | "suffix";
  groups: string[];
  type: string;
  required_level: number;
  stats: StatRange[];
}

/** A bench craft (domain "crafted") that a bench option of this class adds. */
export interface CraftedModRecord extends LiteModRecord {
  /**
   * bench_tier of the bench option that adds it. On the one item seen so far the in-game
   * "(Rank: n)" of a crafted mod equalled this number; the parser only warns when it does not. // VERIFY
   */
  bench_tier: number;
}

/** An unveiled mod (domain "unveiled") with a positive weight on at least one tag set of this class. */
export interface UnveiledModRecord extends LiteModRecord {
  /** ORDERED, as ModRecord.spawn_weights, so the parser can keep the ones the base's tags allow. */
  spawn_weights: TagWeight[];
}

/**
 * An item-domain prefix/suffix that is absent from PoolFile.mods and whose spawn_weights name one
 * of this class's influence tags (item_classes.json influence_tags). Weight > 0 on the tag for the
 * ordinary influence mods; 0 for the Maven-elevated versions, which the game only creates by
 * elevating. Not rolled by the engine yet (influence is v2); the parser records them as
 * unresolved-influence.
 */
export interface InfluenceModRecord extends LiteModRecord {
  /**
   * shaper | elder | crusader | hunter | redeemer | warlord, from the tags this mod names. The
   * weight arrays are left out on purpose (they doubled the class files); the v2 build that rolls
   * influence mods will add them back from mods.json.
   */
  influences: string[];
  /** true when no influence tag of this class has weight > 0 (an elevated version). */
  elevated: boolean;
}

/** The still-veiled placeholder mods (domain "veiled"): "Veiled" / "of the Veil" and the master-named ones. */
export interface VeiledModRecord {
  id: string;
  name: string;
  side: "prefix" | "suffix";
}

/** Text and stats of an implicit mod a base of this class carries (mods.json, keyed by BaseRecord.implicits). */
export interface ImplicitModRecord {
  text: string;
  stats: StatRange[];
}

export interface PoolFile {
  schema: 2;
  /**
   * ISO 8601 of the newest Last-Modified header among the RePoE inputs, i.e. the data's version,
   * not the time the build ran, so a re-run over unchanged data rewrites identical files.
   */
  generated: string;
  source: {
    repoe: string;
    /** Last-Modified header of mods.json when it was fetched, if the server sent one. */
    mods_last_modified: string | null;
    /** The newest Last-Modified among all eight inputs (what `generated` is derived from). */
    data_last_modified: string | null;
  };
  item_class: string;
  /** item_classes.json influence_tags for this class (six: crusader, elder, basilisk = Hunter, eyrie = Redeemer, shaper, adjudicator = Warlord). */
  influence_tags: string[];
  /** Released, domain "item" bases of this class. */
  bases: BaseRecord[];
  /**
   * In mods.json key order (a subset preserving relative order). Contains every item-domain
   * prefix/suffix mod with weight > 0 on at least one tag set of this class, plus every mod
   * (essence-only or not) that an essence forces on this class, even when it has weight 0 on
   * every tag set. Draw order in the roll engine follows this order, so it must not be re-sorted.
   *
   * NOT included yet: mods that only roll with an influence tag (body_armour_shaper, axe_elder,
   * ...). Until build-data adds them (item_classes.json carries each class's influence_tags),
   * buildPool's extraTags cannot enable them. Influence is v2 (BRIEF.md §5).
   */
  mods: ModRecord[];
  tag_sets: TagSetRecord[];
  /**
   * Essences that have a forced mod for this class. Remnant of Corruption is absent everywhere
   * (its mods map is null for every class). RePoE keys essence mods by 22 classes only, so the
   * Rune Dagger, Warstaff and FishingRod files carry none. The two weapon classes can be
   * essence-reforged in the game; whether they use the Dagger / Staff mod is unconfirmed. // VERIFY
   */
  essences: EssenceRecord[];
  /** Bench options whose item_classes include this class. */
  bench: BenchRecord[];
  /** All 25 fossils (they are not class-specific; repeated in every file for self-containment). */
  fossils: FossilRecord[];
  /** Implicit mods referenced by `bases[].implicits`, keyed by mod id. Lets the parser tell same-name bases apart. */
  implicit_mods: Record<string, ImplicitModRecord>;
  /** The crafted mod of every `bench[]` option with add_explicit_mod, in bench order, each id once. */
  crafted_mods: CraftedModRecord[];
  /** Unveiled mods with weight > 0 on at least one tag set of this class, in mods.json order. */
  unveiled_mods: UnveiledModRecord[];
  /** Influence-gated mods for this class (see InfluenceModRecord), in mods.json order. */
  influence_mods: InfluenceModRecord[];
  /** The 22 veiled placeholder mods (class-independent; repeated in every file for self-containment). */
  veiled_mods: VeiledModRecord[];
}

/**
 * public/data/other_mods.json.gz: every prefix/suffix mod of the equipment domains (item, crafted,
 * unveiled, delve, mercenary, ducat_crafted) that no class file lists. Nothing here can be rolled
 * by the engine (no base has a positive weight for it, or it comes from a system v1 does not model:
 * Incursion, Delve fossils, Betrayal, the mercenary gear of 3.26, Aspect crafts, elevated mods on
 * other classes). The parser uses it to name such a mod on a pasted item instead of failing.
 */
export interface OtherModRecord extends LiteModRecord {
  domain: string;
  /** Tags with a positive spawn weight, if any. */
  tags: string[];
}

export interface OtherModsFile {
  schema: 2;
  generated: string;
  source: PoolFile["source"];
  mods: OtherModRecord[];
}

/** public/data/index.json */
export interface DataIndex {
  schema: 2;
  generated: string;
  source: PoolFile["source"];
  /** `bases` counts the bases in the file, Royale copies included. `name` is the in-game "Item Class:" display name. */
  classes: { item_class: string; name: string; file: string; bases: number; mods: number }[];
  other_mods: { file: string; mods: number };
  /**
   * Every base in every class file except the ten Royale-mode copies (ids like ".../BeltRoyale1";
   * they stay in the class files, they are just not offered here). Display names are still not
   * unique: talisman variants, the three Two-Stone Rings, legacy quivers, three Two-Toned Boots
   * with different tags, and Energy Blade in both One Hand Sword and Two Hand Sword. Match on id
   * when it matters.
   */
  bases: { name: string; id: string; item_class: string; drop_level: number }[];
}

/** Map an item class to its data file name. */
export function poolFileName(itemClass: string): string {
  return `${itemClass.replace(/\s+/g, "_")}.json.gz`;
}

// ---------------------------------------------------------------------------
// Engine-side types (what buildPool produces and rollRare consumes)
// ---------------------------------------------------------------------------

/** One mod as it sits in a built pool for a specific base + item level. Mirrors poc/engine.mjs. */
export interface PoolMod {
  id: string;
  name: string;
  /** First line of the mod text (the POC's `text`). */
  text: string;
  side: "prefix" | "suffix";
  /** groups[0], falling back to type (POC: `m.groups[0] ?? m.type`). */
  group: string;
  type: string;
  /** required_level. */
  level: number;
  /** Resolved spawn x generation weight for this base's tags; 0 for essence-only mods. */
  weight: number;
  /** stats[0].max, or null when the mod has no stats. */
  statMax: number | null;
  essenceOnly: boolean;
  addsTags: string[];
  /**
   * 1 = best, independent of item level. Rollable mods: rank by required_level (desc) within
   * (group, side, type) over every mod that can roll on this base's tags at any level, so the
   * number matches the in-game "(Tier: n)" and Craft of Exile. Essence-only mods: 1 + number of
   * rollable tiers in the same (group, side, type) whose first-stat max beats this mod's; null if
   * the mod has no stats.
   */
  tier: number | null;
  /** Index into PoolFile.mods. */
  index: number;
}

export interface PoolInfo {
  base: BaseRecord;
  ilvl: number;
  /** base.tags + extraTags. */
  tags: Set<string>;
  /** In PoolFile.mods order. */
  pool: PoolMod[];
}

/** "This mod at this tier or better." */
export interface SimplePick {
  group: string;
  side?: "prefix" | "suffix";
  minTier: number;
}

/** "Any k of these." */
export interface KOfPick {
  kOf: number;
  options: SimplePick[];
}

export type TargetPick = SimplePick | KOfPick;

/** Every pick must be satisfied. */
export type Target = TargetPick[];
