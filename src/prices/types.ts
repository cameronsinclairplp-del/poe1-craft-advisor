// Price snapshot contract between scripts/snapshot-prices.ts (producer) and the browser (consumer).
//
// One PriceSnapshot per league, written pretty-printed to public/prices/<league>.json (the league
// id verbatim, e.g. public/prices/Allflame.json). The browser never calls poe.ninja itself: it
// loads this file, so every price it shows is at most as fresh as the last snapshot run.
//
// Pure type file: no runtime code, no imports. It is compiled under both tsconfig.json (DOM) and
// tsconfig.node.json (scripts), so it must stay free of anything environment-specific.
//
// All numbers are copied from poe.ninja verbatim (chaos per unit); nothing is derived or invented.

/** Chaos price of one tradeable item (currency, essence, fossil or resonator). */
export interface PriceEntry {
  /** poe.ninja line/item id, e.g. "divine", "deafening-essence-of-greed". */
  id: string;
  /** Chaos Orbs per unit: poe.ninja exchange `lines[].primaryValue`. */
  chaos: number;
}

/**
 * One exchange endpoint (type Currency, Essence, Fossil or Resonator), keyed by display name so
 * the engine can look up "Chaos Orb" or "Deafening Essence of Greed" directly. Names come from
 * poe.ninja `items[].name` joined to `lines[]` on id.
 */
export interface PriceSection {
  /** ISO 8601: when this section's data was fetched from (or last revalidated against) poe.ninja. */
  fetched: string;
  /**
   * true when the fetch failed and the section was carried over unchanged from the previous
   * snapshot (BRIEF.md section 8 risk 4: stale prices with a timestamp, never a broken app).
   */
  stale: boolean;
  items: Record<string, PriceEntry>;
}

/** One poe.ninja BaseType line: a base at a required level, plain or with a single influence. */
export interface BaseTypeLine {
  name: string;
  /** poe.ninja `levelRequired`. For bases this is the item level bracket the listing was priced at. */
  level_required: number;
  /**
   * null for a plain base; a single influence name ("Shaper", "Elder", "Crusader", "Redeemer",
   * "Hunter", "Warlord") otherwise. Double-influence lines ("Warlord/Hunter") are dropped by the
   * snapshot script: out of scope until v3 and mostly single noisy listings.
   */
  variant: string | null;
  /** poe.ninja `chaosValue`. */
  chaos: number;
  /** poe.ninja `count`. */
  count: number;
  /** poe.ninja `listingCount`. */
  listing_count: number;
}

export interface BaseTypeSection {
  /** ISO 8601, same meaning as PriceSection.fetched. */
  fetched: string;
  /** Same meaning as PriceSection.stale. */
  stale: boolean;
  /** Sorted by name, then level_required, then variant (null first), so re-runs diff cleanly. */
  lines: BaseTypeLine[];
}

/** The four exchange sections of a snapshot, in the order the script fetches them. */
export type ExchangeSectionKey = "currency" | "essence" | "fossil" | "resonator";

/** public/prices/<league>.json */
export interface PriceSnapshot {
  schema: 1;
  /** poe.ninja league id, e.g. "Allflame". */
  league: string;
  /** ISO 8601: when the snapshot file was written. */
  generated: string;
  source: "poe.ninja";
  /**
   * Chaos per Divine Orb (currency line id "divine"), for showing Divines alongside chaos
   * (CLAUDE.md conventions). null only if the currency section has no Divine Orb line.
   */
  divine_chaos: number | null;
  currency: PriceSection;
  essence: PriceSection;
  fossil: PriceSection;
  resonator: PriceSection;
  base_types: BaseTypeSection;
}
