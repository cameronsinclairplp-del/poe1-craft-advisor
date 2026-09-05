// Errors thrown by the item-text parser. Every one names the paste line it is about when there
// is one, so the message can be shown next to the paste box as it is.

export type ParseErrorCode =
  | "empty"
  | "no-item-class"
  | "unsupported-class"
  | "unsupported-rarity"
  | "unidentified"
  | "malformed"
  | "bad-header"
  | "unknown-base"
  | "ambiguous-base"
  | "unknown-mod"
  | "ambiguous-mod"
  | "tier-mismatch";

export interface LineRef {
  /** 1-based line number in the text as pasted (leading "#" comment lines count). */
  line: number;
  text: string;
}

export class ParseError extends Error {
  readonly code: ParseErrorCode;
  readonly line: number | null;
  readonly lineText: string | null;

  constructor(code: ParseErrorCode, message: string, where?: LineRef) {
    super(where ? `${message} (line ${where.line}: ${JSON.stringify(where.text)})` : message);
    this.name = "ParseError";
    this.code = code;
    this.line = where?.line ?? null;
    this.lineText = where?.text ?? null;
  }
}

/** The "Item Class:" line names a class without a data file (jewels, flasks, maps, ...). */
export class UnsupportedItemClassError extends ParseError {
  readonly itemClassName: string;

  constructor(itemClassName: string, supported: readonly string[], where?: LineRef) {
    super(
      "unsupported-class",
      `item class "${itemClassName}" is not supported (v1 covers ${supported.length} classes: ${supported.join(", ")})`,
      where,
    );
    this.name = "UnsupportedItemClassError";
    this.itemClassName = itemClassName;
  }
}

/** Base name not found for the item class, after the Superior / Synthesised / Vestigial prefixes and magic affix names are removed. */
export class UnknownBaseError extends ParseError {
  readonly baseName: string;

  constructor(baseName: string, itemClass: string, where?: LineRef) {
    super("unknown-base", `no ${itemClass} base named "${baseName}" in the data`, where);
    this.name = "UnknownBaseError";
    this.baseName = baseName;
  }
}

/** Several bases share the name and neither the implicit nor the requirements tell them apart. */
export class AmbiguousBaseError extends ParseError {
  readonly candidates: string[];

  constructor(baseName: string, candidates: readonly string[], why: string, where?: LineRef) {
    super("ambiguous-base", `base "${baseName}" could be any of ${candidates.join(", ")}: ${why}`, where);
    this.name = "AmbiguousBaseError";
    this.candidates = [...candidates];
  }
}

/** A mod name that no list in the data has for this side, text and value ranges. Never guessed. */
export class UnknownModError extends ParseError {
  readonly modName: string;
  readonly side: "prefix" | "suffix";
  /** Same name and side, different text or ranges: "<id>: <text>" per near miss. */
  readonly nearMisses: string[];

  constructor(modName: string, side: "prefix" | "suffix", nearMisses: readonly string[], where: LineRef) {
    super(
      "unknown-mod",
      `unknown ${side} "${modName}"` +
        (nearMisses.length ? `; same name but different text or ranges: ${nearMisses.join(" | ")}` : "; no mod of that name and side in the data"),
      where,
    );
    this.name = "UnknownModError";
    this.modName = modName;
    this.side = side;
    this.nearMisses = [...nearMisses];
  }
}

/** Name, side, text and ranges all match more than one mod. Never guessed. */
export class AmbiguousModError extends ParseError {
  readonly candidates: string[];

  constructor(modName: string, side: "prefix" | "suffix", candidates: readonly string[], where: LineRef) {
    super("ambiguous-mod", `${side} "${modName}" matches ${candidates.length} mods equally: ${candidates.join(", ")}`, where);
    this.name = "AmbiguousModError";
    this.candidates = [...candidates];
  }
}

export interface LadderEntry {
  id: string;
  name: string;
  level: number;
  tier: number | null;
  text: string;
}

/**
 * The in-game "(Tier: n)" disagrees with the engine's level-independent tier for the resolved
 * mod. This is the loud failure CLAUDE.md asks for: either the tiering rule (STATUS.md VERIFY 7/8)
 * or the data is wrong for this base, and the item must not be fed to the solver as if it were right.
 */
export class TierMismatchError extends ParseError {
  readonly modId: string;
  readonly modName: string;
  readonly side: "prefix" | "suffix";
  readonly gameTier: number;
  readonly ourTier: number;
  /** The (group, side) ladder the engine ranked, best first. */
  readonly ladder: LadderEntry[];
  /** Rank of the mod among pool mods with the same RePoE `type` and side (a diagnostic for VERIFY 7), null if not computable. */
  readonly typeTier: number | null;

  constructor(args: {
    modId: string;
    modName: string;
    side: "prefix" | "suffix";
    gameTier: number;
    ourTier: number;
    ladderKey: string;
    ladder: LadderEntry[];
    typeTier: number | null;
    where: LineRef;
  }) {
    const ladderText = args.ladder.map((e) => `T${e.tier ?? "?"} L${e.level} ${e.id} "${e.text}"`).join("; ");
    super(
      "tier-mismatch",
      `${args.side} "${args.modName}" resolved to ${args.modId}: the game says Tier ${args.gameTier}, the engine's ladder ${args.ladderKey} says T${args.ourTier}` +
        (args.typeTier !== null && args.typeTier !== args.ourTier ? ` (ranked by RePoE type instead it would be T${args.typeTier})` : "") +
        `. Ladder: ${ladderText}`,
      args.where,
    );
    this.name = "TierMismatchError";
    this.modId = args.modId;
    this.modName = args.modName;
    this.side = args.side;
    this.gameTier = args.gameTier;
    this.ourTier = args.ourTier;
    this.ladder = args.ladder;
    this.typeTier = args.typeTier;
  }
}
