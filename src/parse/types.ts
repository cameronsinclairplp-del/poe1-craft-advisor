// What the milestone 3 parser produces from a Ctrl+Alt+C paste (BRIEF.md §6, HANDOVER.md Step A).

export type Rarity = "normal" | "magic" | "rare" | "unique";
export type Side = "prefix" | "suffix";

export type Influence = "shaper" | "elder" | "crusader" | "hunter" | "redeemer" | "warlord" | "searing-exarch" | "eater-of-worlds";

/** Bench metamods (BRIEF.md §3 state.metamod, plus multimod). */
export type Metamod = "prefixes-locked" | "suffixes-locked" | "no-attack-mods" | "no-caster-mods" | "multimod";

/**
 * Which list of the data the mod was found in.
 *   pool       a prefix/suffix the engine can roll on this item class (PoolFile.mods); modId set, tier cross-checked
 *   crafted    a bench craft (PoolFile.crafted_mods); modId set
 *   unveiled   an unveiled Betrayal mod (PoolFile.unveiled_mods); modId set, no ladder to check the tier against
 *   veiled     a still-veiled placeholder (PoolFile.veiled_mods); modId set
 *   influence  an influence-gated mod (PoolFile.influence_mods): recorded as unresolved, modId null (STATUS.md VERIFY 9)
 *   other      known to RePoE but not rollable by anything v1 models (other_mods.json.gz); modId set, occupies its slot
 *   unique     a mod on a unique item: rarity only, nothing resolved
 */
export type ModKind = "pool" | "crafted" | "unveiled" | "veiled" | "influence" | "other" | "unique";

export type TierCheck =
  /** game tier present, engine tier present, equal */
  | "ok"
  /**
   * game tier present, engine tier present, different. A warning naming both numbers and the whole
   * ladder is recorded on the item; nothing throws. Resolution is by name, side, text and ranges, so
   * the mod is still the right one and the number is informational (STATUS.md VERIFY 13 is the open case).
   */
  | "mismatch"
  /** the header had no "(Tier: n)" (essence mods, crafted mods, some special mods) */
  | "no-game-tier"
  /** nothing to compare against: not a pool mod, or a pool mod that cannot roll on this base */
  | "no-ladder";

export interface ItemMod {
  side: Side;
  /** Affix name from the header, e.g. "Athlete's". */
  name: string;
  /** "(Tier: n)" from the header; null when absent. */
  tier: number | null;
  /** "(Rank: n)" from the header (bench crafts); null when absent. */
  rank: number | null;
  /** Stat lines as pasted (rolls kept, markers removed), joined with "\n". */
  text: string;
  lines: string[];
  /** Tags printed after the dash in the header, e.g. ["Elemental", "Fire", "Resistance"]. */
  tags: string[];
  modId: string | null;
  kind: ModKind;
  flags: { crafted: boolean; fractured: boolean; veiled: boolean; unveiled: boolean };
  /** The engine's level-independent tier for pool mods; null otherwise. */
  ourTier: number | null;
  tierCheck: TierCheck;
  /** kind "influence": the influences whose tag the mod carries. */
  influences?: Influence[];
  /** kind "influence": the influence mod ids that match name, side, text and ranges. */
  candidates?: string[];
  /** kind "other": the RePoE domain (item, crafted, delve, mercenary, ...). */
  domain?: string;
  /** 1-based line of the header in the pasted text. */
  line: number;
}

export type ImplicitKind = "implicit" | "corrupted" | "vestigial" | "eldritch" | "enchant";

export interface ImplicitMod {
  kind: ImplicitKind;
  /** kind "eldritch": which altar. */
  source?: "searing-exarch" | "eater-of-worlds";
  /** kind "eldritch": Lesser | Greater | Grand | Exceptional | Exquisite | Perfect. */
  eldritchTier?: string;
  /** The words before "Implicit Modifier" in the header when they were not one of the known kinds. */
  variant?: string;
  text: string;
  lines: string[];
  tags: string[];
  line: number;
}

/** A "{ Unique Modifier }" block on a unique item. */
export interface UniqueMod {
  text: string;
  lines: string[];
  tags: string[];
  line: number;
}

export interface Item {
  /** RePoE item class id, e.g. "Body Armour"; the class file's name. */
  itemClass: string;
  /** In-game "Item Class:" display name, e.g. "Body Armours". */
  itemClassName: string;
  base: { id: string; name: string };
  /** The rare / unique name; null for normal and magic items. */
  name: string | null;
  rarity: Rarity;
  ilvl: number;
  influences: Influence[];
  corrupted: boolean;
  mirrored: boolean;
  split: boolean;
  synthesised: boolean;
  /** A "Vestigial <base>" (3.29) with a "{ Vestigial Implicit Modifier }". */
  vestigial: boolean;
  /** The "Fractured Item" footer was present. */
  fracturedItem: boolean;
  /** Explicit prefixes and suffixes (uniques: their prefix/suffix-headed mods, unresolved). */
  mods: ItemMod[];
  implicits: ImplicitMod[];
  enchants: ImplicitMod[];
  eldritchImplicits: ImplicitMod[];
  uniqueMods: UniqueMod[];
  /** Slot capacity for this rarity and base (Helical Ring / Simplex Amulet implicits shift these). */
  maxPrefixes: number;
  maxSuffixes: number;
  openPrefixes: number;
  openSuffixes: number;
  metamods: Metamod[];
  /** Non-fatal notes: unrecognised lines, ignored systems (Crucible, Scourge), soft cross-checks. */
  warnings: string[];
}
