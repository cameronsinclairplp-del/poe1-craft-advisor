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
  | "ambiguous-mod";

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

/**
 * Name, side, text and ranges all match more than one mod (for the shared list of unrollable mods,
 * after the base's tags failed to single one out). Never guessed.
 */
export class AmbiguousModError extends ParseError {
  readonly candidates: string[];

  constructor(modName: string, side: "prefix" | "suffix", candidates: readonly string[], where: LineRef) {
    super("ambiguous-mod", `${side} "${modName}" matches ${candidates.length} mods equally: ${candidates.join(", ")}`, where);
    this.name = "AmbiguousModError";
    this.candidates = [...candidates];
  }
}

// A disagreement between the in-game "(Tier: n)" and the engine's ladder is not an error: the mod is
// resolved by name, side, text and ranges, so it is the right mod and the number is informational.
// The parser records it as a warning on the item with ItemMod.tierCheck = "mismatch" (STATUS.md
// VERIFY 13 is the open case). Until 05/09/2026 it threw a TierMismatchError.
