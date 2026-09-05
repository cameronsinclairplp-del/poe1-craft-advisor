// Text helpers for matching pasted stat lines against RePoE mod text.
//
// A pasted line shows the roll and the tier's range: "+105(100-114) to maximum Life",
// "Adds 34(34-46) to 77(68-80) Fire Damage", "+2(1) to Minimum Endurance Charges". RePoE's text
// shows only the range: "+(100-114) to maximum Life". Both reduce to the same template
// "+# to maximum Life"; the ranges then tell tiers of one family apart when the name does not.

/** "(a-b)" or "(a)", with optional signs and decimals: the range the game prints after a roll. */
const RANGE_RE = /\(\s*[+-]?\d+(?:\.\d+)?(?:\s*-\s*[+-]?\d+(?:\.\d+)?)?\s*\)/g;
/** An unsigned number; the sign stays in the template ("+# to" vs "-# to"). */
const NUMBER_RE = /\d+(?:\.\d+)?/g;

/** Reduce a stat line or a whole mod text to its shape: every number and range becomes "#". */
export function templateOf(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(RANGE_RE, "#").replace(NUMBER_RE, "#").replace(/#+/g, "#").replace(/\s+/g, " ").trim())
    .join("\n");
}

export type Range = readonly [number, number];

/** The "(a-b)" / "(a)" ranges in a pasted line or a RePoE text, in order. */
export function rangesOf(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const inner = m[0].slice(1, -1).replace(/\s+/g, "");
    // "a-b", "-a--b", "a" ...: split on the "-" that separates two numbers, not a leading sign.
    const parts = inner.match(/^([+-]?\d+(?:\.\d+)?)(?:-([+-]?\d+(?:\.\d+)?))?$/);
    if (!parts) continue;
    const a = Number(parts[1]);
    const b = parts[2] === undefined ? a : Number(parts[2]);
    out.push([a, b]);
  }
  return out;
}

/**
 * The values a RePoE text can show: its ranges plus its fixed numbers (as [n, n]), because the game
 * prints a fixed value's "range" as "(n)" when the roll was scaled ("+2(1) to Minimum Endurance Charges").
 */
export function valuesOf(text: string): Range[] {
  const ranges = rangesOf(text);
  const withoutRanges = text.replace(RANGE_RE, " ");
  for (const m of withoutRanges.matchAll(NUMBER_RE)) {
    const n = Number(m[0]);
    ranges.push([n, n]);
  }
  return ranges;
}

/** true when every range in `needles` occurs in `haystack` (multiset containment). */
export function rangesContained(needles: readonly Range[], haystack: readonly Range[]): boolean {
  const pool = haystack.map((r) => `${r[0]}..${r[1]}`);
  for (const r of needles) {
    const key = `${r[0]}..${r[1]}`;
    const i = pool.indexOf(key);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

export type LineTrailer = "implicit" | "crafted" | "fractured" | "enchant" | "scourge" | "eldritch" | "unscalable" | "veiled" | "synthesised" | "augmented";

const TRAILER_RE = /\s*\((implicit|crafted|fractured|enchant|scourge|eldritch|unscalable|veiled|synthesised|augmented)\)$/i;
const UNSCALABLE_RE = /\s*—\s*Unscalable Value$/;

/**
 * Remove the markers the game appends to a line ("(implicit)", "(crafted)", "(fractured)",
 * "(enchant)", "— Unscalable Value", ...) and report which were there. Older clients marked
 * every crafted / fractured line; current ones mark the header instead, so both are honoured.
 */
export function stripTrailers(line: string): { text: string; trailers: Set<LineTrailer> } {
  const trailers = new Set<LineTrailer>();
  let text = line.trim();
  for (;;) {
    const t = TRAILER_RE.exec(text);
    if (t) {
      trailers.add(t[1]!.toLowerCase() as LineTrailer);
      text = text.slice(0, t.index).trimEnd();
      continue;
    }
    const u = UNSCALABLE_RE.exec(text);
    if (u) {
      trailers.add("unscalable");
      text = text.slice(0, u.index).trimEnd();
      continue;
    }
    return { text, trailers };
  }
}

/** Reminder text the game prints under some mods: a whole line in parentheses. */
export function isReminderLine(text: string): boolean {
  return /^\(.*\)$/.test(text.trim());
}
