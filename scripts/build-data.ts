// scripts/build-data.ts — milestone 1 data build: RePoE fork -> public/data/
//
// What it produces
//   One gzipped PoolFile (see src/engine/types.ts) per item class that has at least one released,
//   domain "item" base and at least one rollable prefix/suffix mod:
//     public/data/<Item_Class>.json.gz   bases, mods, per-tag-set weights + tier ladders, essences,
//                                        bench options, the 25 fossils
//     public/data/index.json             DataIndex: every class file and every base it contains,
//                                        minus the ten Royale-mode copies (which stay in the files)
//   Stale *.json.gz files in public/data that this build did not produce are removed.
//
// How to run
//   npm run build-data                 # revalidate cached RePoE files older than 24 h, build, check
//   npm run build-data -- --refresh    # revalidate every cached file regardless of age
//   npm run build-data -- --offline    # never touch the network; fails if a cached file is missing
//
// Raw downloads are cached in .cache/repoe/<name>.json with the HTTP response headers alongside in
// .cache/repoe/<name>.headers (status line + "Name: value" lines, the format curl -D writes). The
// ETag and Last-Modified in that file drive the conditional requests (If-None-Match /
// If-Modified-Since); a 304 keeps the cached body and resets its age.
//
// Self-checks (all fatal, exit code 1 with a clear message)
//   1. gzip round trip: every written file is re-read, gunzipped and parsed, and THAT object is
//      what the checks below run on.
//   2. consistency with the runtime: for every base, buildPool(file, base, 100) must agree with the
//      pre-resolved tag-set weights and tier ladders in the file.
//   3. BRIEF.md §7.1: Astral Plate ilvl 86 has 109 rollable mods; life T1 = +(175-189) at L86,
//      T2 = 160-174 at L81; fire res T1 = 46-48 at L84.
//
// Nothing in the output is invented: every field is copied from RePoE, and the derived fields
// (weights, tiers) are computed with the same functions the engine uses at runtime. Two selection
// decisions are ours and are logged: classes whose item_classes.json category is null are skipped
// (HiddenItem: 55 "Random ..." gamble/idol placeholders that can never be pasted or crafted), and a
// mod an essence forces on a class is kept even when it has weight 0 on every tag set.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { buildPool, findBase, resolveGenMultiplier, resolveWeight } from "../src/engine/pool.ts";
import { poolFileName } from "../src/engine/types.ts";
import type {
  BaseRecord,
  BenchRecord,
  CraftedModRecord,
  DataIndex,
  EssenceRecord,
  FossilRecord,
  ImplicitModRecord,
  InfluenceModRecord,
  LiteModRecord,
  ModRecord,
  OtherModRecord,
  OtherModsFile,
  PoolFile,
  PoolMod,
  StatRange,
  TagSetRecord,
  TagWeight,
  UnveiledModRecord,
  VeiledModRecord,
} from "../src/engine/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(ROOT, ".cache", "repoe");
const OUT_DIR = resolve(ROOT, "public", "data");

const REPOE = "https://repoe-fork.github.io"; // PoE 1 files live at the root
const REPOE_FILES = [
  "mods",
  "base_items",
  "essences",
  "fossils",
  "crafting_bench_options",
  "mod_types",
  "tags",
  "item_classes",
] as const;
type RepoeFileName = (typeof REPOE_FILES)[number];

const USER_AGENT = "poe1-craft-advisor build-data/0.1 (+https://github.com/cameronsinclairplp-del/poe1-craft-advisor)";
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

/** Item level used for the consistency check. Every item-domain mod has required_level <= 95 today. */
const CHECK_ILVL = 100;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  refresh: boolean;
  offline: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { refresh: false, offline: false };
  for (const arg of argv) {
    if (arg === "--refresh") opts.refresh = true;
    else if (arg === "--offline") opts.offline = true;
    else throw new Error(`unknown argument ${arg} (expected --refresh and/or --offline)`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Raw RePoE shapes (only the fields this script reads)
// ---------------------------------------------------------------------------

interface RawMod {
  domain: string;
  generation_type: string;
  name: string;
  /** null on three unreleased StormBlade mods (weight 0 everywhere, never selected). */
  text: string | null;
  groups: string[];
  type: string;
  required_level: number;
  is_essence_only: boolean;
  spawn_weights: TagWeight[];
  generation_weights: TagWeight[];
  adds_tags: string[];
  implicit_tags: string[];
  stats: StatRange[];
}

interface RawBase {
  domain?: string;
  release_state: string;
  item_class: string;
  name: string;
  tags: string[];
  drop_level: number;
  implicits: string[];
  requirements: BaseRecord["requirements"];
}

interface RawEssence {
  name: string;
  level: number;
  /** item class -> forced mod id. Remnant of Corruption has null for every class. */
  mods: Record<string, string | null>;
  item_level_restriction: number | null;
  spawn_level_min: number;
  type: { tier: number; is_corruption_only: boolean };
}

type RawFossil = Omit<FossilRecord, "id">;

interface RawItemClass {
  /** In-game display name, the "Item Class:" line of a pasted item (e.g. "Body Armours", "Rune Daggers"). */
  name: string;
  /** null for HiddenItem (gamble/idol placeholders) and other non-equipment classes. */
  category: string | null;
  /** The six influence tags of an equipment class; null for classes that cannot be influenced. */
  influence_tags: string[] | null;
}

interface RepoeData {
  mods: Record<string, RawMod>;
  bases: Record<string, RawBase>;
  essences: Record<string, RawEssence>;
  fossils: Record<string, RawFossil>;
  bench: BenchRecord[];
  itemClasses: Record<string, RawItemClass>;
  /** Last-Modified header of mods.json, from the cached .headers file. */
  modsLastModified: string | null;
  /** The newest Last-Modified among all inputs; null when no input carried the header. */
  dataLastModified: string | null;
}

// ---------------------------------------------------------------------------
// Download + cache
// ---------------------------------------------------------------------------

interface CachedFile {
  text: string;
  /** Lower-cased header name -> value. */
  headers: Map<string, string>;
  how: "cached" | "revalidated" | "downloaded";
}

/** Parse a .headers file: optional status line, then "Name: value" lines (CRLF or LF). */
function parseHeaderFile(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("HTTP/")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

/** Same format as the existing .headers files: status line, then one header per line, CRLF. */
function formatHeaderFile(res: Response): string {
  const lines = [`HTTP/1.1 ${res.status} ${res.statusText}`.trimEnd()];
  for (const [name, value] of res.headers) lines.push(`${name}: ${value}`);
  return `${lines.join("\r\n")}\r\n`;
}

function readCached(jsonPath: string, headersPath: string): Omit<CachedFile, "how"> | null {
  if (!existsSync(jsonPath)) return null;
  const headers = existsSync(headersPath) ? parseHeaderFile(readFileSync(headersPath, "utf8")) : new Map<string, string>();
  return { text: readFileSync(jsonPath, "utf8"), headers };
}

async function loadRepoeFile(name: RepoeFileName, opts: Options): Promise<CachedFile> {
  const jsonPath = resolve(CACHE_DIR, `${name}.json`);
  const headersPath = resolve(CACHE_DIR, `${name}.headers`);
  const cached = readCached(jsonPath, headersPath);

  if (opts.offline) {
    if (!cached) throw new Error(`--offline: ${jsonPath} is missing; run once without --offline to download it`);
    return { ...cached, how: "cached" };
  }
  if (cached && !opts.refresh && Date.now() - statSync(jsonPath).mtimeMs < MAX_CACHE_AGE_MS) {
    return { ...cached, how: "cached" };
  }

  const request: Record<string, string> = { "User-Agent": USER_AGENT };
  const etag = cached?.headers.get("etag");
  const lastModified = cached?.headers.get("last-modified");
  if (etag) request["If-None-Match"] = etag;
  if (lastModified) request["If-Modified-Since"] = lastModified;

  const url = `${REPOE}/${name}.json`;
  const res = await fetch(url, { headers: request });
  if (res.status === 304 && cached) {
    const now = new Date();
    utimesSync(jsonPath, now, now); // the body is still current: reset its age
    return { ...cached, how: "revalidated" };
  }
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  const headerText = formatHeaderFile(res);
  writeFileSync(jsonPath, text);
  writeFileSync(headersPath, headerText);
  return { text, headers: parseHeaderFile(headerText), how: "downloaded" };
}

async function loadRepoeData(opts: Options): Promise<RepoeData> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const loaded = await Promise.all(REPOE_FILES.map(async (name) => [name, await loadRepoeFile(name, opts)] as const));
  const parsed = new Map<RepoeFileName, unknown>();
  for (const [name, file] of loaded) {
    parsed.set(name, JSON.parse(file.text)); // parse every file, even the ones we only cache, so bad JSON fails here
    const age = ((Date.now() - statSync(resolve(CACHE_DIR, `${name}.json`)).mtimeMs) / 3_600_000).toFixed(1);
    const lm = file.headers.get("last-modified") ?? "no Last-Modified header";
    console.log(`  ${`${name}.json`.padEnd(28)} ${fmtInt(Buffer.byteLength(file.text)).padStart(12)} bytes  ${file.how.padEnd(11)} age ${age} h  ${lm}`);
  }
  const take = <T>(name: RepoeFileName): T => {
    const value = parsed.get(name);
    if (value === undefined) throw new Error(`${name}.json was not loaded`);
    return value as T;
  };
  const modsFile = loaded.find(([name]) => name === "mods");
  // The data's version is the newest Last-Modified among the inputs. A missing or unparsable
  // header is skipped; `generated` then falls back to the run time (main() warns).
  let newest: { ms: number; text: string } | null = null;
  for (const [, file] of loaded) {
    const text = file.headers.get("last-modified");
    if (!text) continue;
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) continue;
    if (!newest || ms > newest.ms) newest = { ms, text };
  }
  return {
    mods: take<Record<string, RawMod>>("mods"),
    bases: take<Record<string, RawBase>>("base_items"),
    essences: take<Record<string, RawEssence>>("essences"),
    fossils: take<Record<string, RawFossil>>("fossils"),
    bench: take<BenchRecord[]>("crafting_bench_options"),
    itemClasses: take<Record<string, RawItemClass>>("item_classes"),
    modsLastModified: modsFile?.[1].headers.get("last-modified") ?? null,
    dataLastModified: newest?.text ?? null,
  };
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

interface Candidate {
  id: string;
  side: "prefix" | "suffix";
  raw: RawMod;
}

/** Every item-domain prefix/suffix mod, in mods.json key order. This order is kept in every PoolFile. */
function itemPrefixSuffixMods(mods: Record<string, RawMod>): Candidate[] {
  const out: Candidate[] = [];
  for (const [id, raw] of Object.entries(mods)) {
    if (raw.domain !== "item") continue;
    if (raw.generation_type !== "prefix" && raw.generation_type !== "suffix") continue;
    out.push({ id, side: raw.generation_type, raw });
  }
  return out;
}

interface RawBaseEntry {
  id: string;
  raw: RawBase;
}

/** Released, domain "item" bases grouped by item class, classes sorted by name. */
function releasedBasesByClass(bases: Record<string, RawBase>): Map<string, RawBaseEntry[]> {
  const byClass = new Map<string, RawBaseEntry[]>();
  for (const [id, raw] of Object.entries(bases)) {
    if (raw.release_state !== "released" || raw.domain !== "item") continue;
    const list = byClass.get(raw.item_class) ?? [];
    list.push({ id, raw });
    byClass.set(raw.item_class, list);
  }
  return new Map([...byClass.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** The 25 real fossils. The other ~420 fossils.json entries have empty names (internal delve entries). */
function selectFossils(fossils: Record<string, RawFossil>): FossilRecord[] {
  const out: FossilRecord[] = [];
  let skipped = 0;
  for (const [id, f] of Object.entries(fossils)) {
    if (!f.name.endsWith("Fossil")) {
      skipped++;
      continue;
    }
    out.push({
      id,
      name: f.name,
      added_mods: f.added_mods,
      forced_mods: f.forced_mods,
      sell_price_mods: f.sell_price_mods,
      positive_mod_weights: f.positive_mod_weights,
      negative_mod_weights: f.negative_mod_weights,
      forbidden_tags: f.forbidden_tags,
      allowed_tags: f.allowed_tags,
      rolls_lucky: f.rolls_lucky,
      rolls_white_sockets: f.rolls_white_sockets,
      mirrors: f.mirrors,
      changes_quality: f.changes_quality,
      corrupted_essence_chance: f.corrupted_essence_chance,
      descriptions: f.descriptions,
      blocked_descriptions: f.blocked_descriptions,
    });
  }
  console.log(`\nFossils: kept ${out.length} whose name ends in "Fossil", skipped ${skipped} unnamed internal entries`);
  if (out.length !== 25) console.log(`  WARNING: expected 25 fossils (BRIEF.md §4), found ${out.length}`);
  return out;
}

// ---------------------------------------------------------------------------
// Record builders (copy RePoE fields verbatim)
// ---------------------------------------------------------------------------

function toModRecord(c: Candidate): ModRecord {
  const m = c.raw;
  return {
    id: c.id,
    name: m.name,
    text: m.text ?? "",
    side: c.side,
    groups: m.groups,
    type: m.type,
    required_level: m.required_level,
    is_essence_only: m.is_essence_only,
    spawn_weights: m.spawn_weights,
    generation_weights: m.generation_weights,
    adds_tags: m.adds_tags,
    implicit_tags: m.implicit_tags,
    stats: m.stats,
  };
}

function toBaseRecord(entry: RawBaseEntry, tagSet: number): BaseRecord {
  const b = entry.raw;
  return {
    id: entry.id,
    name: b.name,
    item_class: b.item_class,
    tags: b.tags,
    drop_level: b.drop_level,
    implicits: b.implicits,
    // Verbatim: null on every released Ring, Amulet, Belt and Quiver base (182 on 05/09/2026).
    requirements: b.requirements,
    tag_set: tagSet,
  };
}

/** Tier ladder key: group identity is groups[0] (CLAUDE.md), falling back to type like the engine does. */
function tierKey(m: ModRecord): string {
  return `${m.groups[0] ?? m.type}|${m.side}`;
}

// ---------------------------------------------------------------------------
// Milestone 3 lists: mods the parser recognises by name and text (never rolled)
// ---------------------------------------------------------------------------

function isSide(gt: string): gt is "prefix" | "suffix" {
  return gt === "prefix" || gt === "suffix";
}

function toLiteRecord(id: string, m: RawMod, side: "prefix" | "suffix"): LiteModRecord {
  return {
    id,
    name: m.name,
    text: m.text ?? "",
    side,
    groups: m.groups,
    type: m.type,
    required_level: m.required_level,
    stats: m.stats,
  };
}

/**
 * Influence tag suffix -> influence name. The three that are not self-evident come from the
 * names of the mods that carry the tag (basilisk: "Hunter's" / "of the Hunt", eyrie: "Redeemer's" /
 * "of Redemption", adjudicator: "Warlord's" / "of the Conquest"); checkInfluenceNames() verifies
 * that against the data on every build and warns if a tag ever carries other names.
 */
const INFLUENCE_BY_TAG_SUFFIX: Record<string, string> = {
  shaper: "shaper",
  elder: "elder",
  crusader: "crusader",
  basilisk: "hunter",
  eyrie: "redeemer",
  adjudicator: "warlord",
};

const INFLUENCE_MOD_NAMES: Record<string, readonly string[]> = {
  shaper: ["The Shaper's", "of Shaping"],
  elder: ["The Elder's", "of the Elder"],
  crusader: ["Crusader's", "of the Crusade"],
  hunter: ["Hunter's", "of the Hunt"],
  redeemer: ["Redeemer's", "of Redemption"],
  warlord: ["Warlord's", "of the Conquest"],
};

function influenceOfTag(tag: string): string {
  const suffix = tag.slice(tag.lastIndexOf("_") + 1);
  const name = INFLUENCE_BY_TAG_SUFFIX[suffix];
  if (!name) throw new Error(`influence tag ${tag} has an unknown suffix "${suffix}"`);
  return name;
}

/**
 * Item-domain prefix/suffix mods that are not in the class's mods list and whose spawn_weights name
 * one of the class's influence tags. Weight > 0: an ordinary influence mod. Weight 0 on every
 * influence tag: a Maven-elevated version (only created by elevating an existing influence mod).
 */
function influenceModsForClass(candidates: readonly Candidate[], inFile: ReadonlySet<string>, influenceTags: readonly string[]): InfluenceModRecord[] {
  const tagSet = new Set(influenceTags);
  const out: InfluenceModRecord[] = [];
  for (const c of candidates) {
    if (inFile.has(c.id)) continue;
    const named = c.raw.spawn_weights.filter((w) => tagSet.has(w.tag));
    if (named.length === 0) continue;
    const influences = [...new Set(named.map((w) => influenceOfTag(w.tag)))];
    const elevated = !named.some((w) => w.weight > 0);
    out.push({ ...toLiteRecord(c.id, c.raw, c.side), influences, elevated });
  }
  return out;
}

/** Warn if an influence tag carries mod names other than the two the mapping above was derived from. */
function checkInfluenceNames(builds: readonly ClassBuild[]): void {
  const seen = new Map<string, Set<string>>();
  for (const { file } of builds) {
    for (const m of file.influence_mods) {
      if (m.elevated) continue;
      for (const inf of m.influences) {
        const names = seen.get(inf) ?? new Set<string>();
        names.add(m.name);
        seen.set(inf, names);
      }
    }
  }
  for (const [inf, names] of seen) {
    const expected = INFLUENCE_MOD_NAMES[inf] ?? [];
    const other = [...names].filter((n) => !expected.includes(n));
    if (other.length) console.log(`  WARNING: ${inf} influence mods also carry names ${other.join(", ")}; the tag -> influence mapping in build-data may need a look`);
  }
  console.log(`  influence names: ${[...seen.entries()].map(([inf, names]) => `${inf}=${[...names].join("/")}`).join(", ")}`);
}

/** Unveiled mods (domain "unveiled") with a positive weight on at least one of the class's tag sets. */
function unveiledModsForClass(mods: Record<string, RawMod>, tagSets: readonly { tags: string[] }[]): UnveiledModRecord[] {
  const sets = tagSets.map((t) => new Set(t.tags));
  const out: UnveiledModRecord[] = [];
  for (const [id, m] of Object.entries(mods)) {
    if (m.domain !== "unveiled" || !isSide(m.generation_type)) continue;
    if (!sets.some((s) => resolveWeight(m.spawn_weights, s) > 0)) continue;
    out.push({ ...toLiteRecord(id, m, m.generation_type), spawn_weights: m.spawn_weights });
  }
  return out;
}

/** The crafted mod behind every bench option of the class that adds an explicit mod, each id once, in bench order. */
function craftedModsForClass(mods: Record<string, RawMod>, bench: readonly BenchRecord[], itemClass: string): CraftedModRecord[] {
  const out: CraftedModRecord[] = [];
  const seen = new Set<string>();
  for (const b of bench) {
    const id = b.actions.add_explicit_mod;
    if (!id || seen.has(id)) continue;
    const m = mods[id];
    if (!m) throw new Error(`${itemClass}: bench option adds ${id}, which is not in mods.json`);
    if (!isSide(m.generation_type)) throw new Error(`${itemClass}: bench mod ${id} is a ${m.generation_type}, not a prefix/suffix`);
    seen.add(id);
    out.push({ ...toLiteRecord(id, m, m.generation_type), bench_tier: b.bench_tier });
  }
  return out;
}

/** Text and stats of every implicit the class's bases reference. */
function implicitModsForClass(mods: Record<string, RawMod>, bases: readonly BaseRecord[], itemClass: string): Record<string, ImplicitModRecord> {
  const out: Record<string, ImplicitModRecord> = {};
  for (const b of bases) {
    for (const id of b.implicits) {
      if (out[id]) continue;
      const m = mods[id];
      if (!m) throw new Error(`${itemClass}: base ${b.id} has implicit ${id}, which is not in mods.json`);
      out[id] = { text: m.text ?? "", stats: m.stats };
    }
  }
  return out;
}

/** The veiled placeholder mods (domain "veiled"), shared by every class file. */
function veiledMods(mods: Record<string, RawMod>): VeiledModRecord[] {
  const out: VeiledModRecord[] = [];
  for (const [id, m] of Object.entries(mods)) {
    if (m.domain !== "veiled" || !isSide(m.generation_type)) continue;
    out.push({ id, name: m.name, side: m.generation_type });
  }
  return out;
}

/** Domains whose prefix/suffix mods can sit on a piece of equipment. */
const EQUIPMENT_DOMAINS: ReadonlySet<string> = new Set(["item", "crafted", "unveiled", "delve", "mercenary", "ducat_crafted"]);

/** Every equipment-domain prefix/suffix that no class file lists (see OtherModsFile). mods.json order. */
function otherMods(mods: Record<string, RawMod>, builds: readonly ClassBuild[]): OtherModRecord[] {
  const listed = new Set<string>();
  for (const { file } of builds) {
    for (const m of file.mods) listed.add(m.id);
    for (const m of file.crafted_mods) listed.add(m.id);
    for (const m of file.unveiled_mods) listed.add(m.id);
    for (const m of file.influence_mods) listed.add(m.id);
  }
  const out: OtherModRecord[] = [];
  for (const [id, m] of Object.entries(mods)) {
    if (!EQUIPMENT_DOMAINS.has(m.domain) || !isSide(m.generation_type) || listed.has(id)) continue;
    out.push({ ...toLiteRecord(id, m, m.generation_type), domain: m.domain, tags: m.spawn_weights.filter((w) => w.weight > 0).map((w) => w.tag) });
  }
  return out;
}

/**
 * "group|side" -> mods indices with weight > 0, highest required_level first. Array.prototype.sort is
 * stable, so equal levels keep mods order, exactly as the runtime buildPool does.
 */
function buildTierLadders(mods: readonly ModRecord[], weights: readonly number[]): Record<string, number[]> {
  const ladders = new Map<string, number[]>();
  mods.forEach((m, i) => {
    if ((weights[i] ?? 0) <= 0) return;
    const ladder = ladders.get(tierKey(m)) ?? [];
    ladder.push(i);
    ladders.set(tierKey(m), ladder);
  });
  for (const ladder of ladders.values()) {
    ladder.sort((a, b) => at(mods, b).required_level - at(mods, a).required_level);
  }
  return Object.fromEntries(ladders);
}

// ---------------------------------------------------------------------------
// Per-class build
// ---------------------------------------------------------------------------

interface ClassStats {
  itemClass: string;
  bases: number;
  tagSets: number;
  mods: number;
  rollableMods: number;
  essences: number;
  bench: number;
  /** Essence-forced mods for this class, split by is_essence_only. */
  forcedEssenceOnly: string[];
  forcedRegular: string[];
  /** Subset of the above that had weight 0 on every tag set (included only because an essence forces them). */
  forcedOtherwiseExcluded: { id: string; essenceOnly: boolean; essences: string[] }[];
  /** Essences whose mods[item_class] is null (Remnant of Corruption) — no forced mod, not recorded. */
  essencesWithoutMod: string[];
  /** Essences whose forced mod id is not an item-domain prefix/suffix in mods.json — dropped. */
  essencesDangling: string[];
  nullRequirementBases: number;
  nullTextMods: number;
  gzBytes: number;
  /** Milestone 3 lists. */
  craftedMods: number;
  unveiledMods: number;
  influenceMods: number;
  elevatedMods: number;
  implicitMods: number;
}

interface ClassBuild {
  file: PoolFile;
  stats: ClassStats;
}

interface BuildContext {
  generated: string;
  source: PoolFile["source"];
  candidates: Candidate[];
  mods: Record<string, RawMod>;
  itemClasses: Record<string, RawItemClass>;
  essences: Record<string, RawEssence>;
  bench: BenchRecord[];
  fossils: FossilRecord[];
  veiled: VeiledModRecord[];
}

/** essence name(s) by forced mod id, for one item class. */
function forcedModsForClass(essences: Record<string, RawEssence>, itemClass: string, stats: ClassStats): Map<string, string[]> {
  const forced = new Map<string, string[]>();
  for (const e of Object.values(essences)) {
    if (!Object.hasOwn(e.mods, itemClass)) continue;
    const modId = e.mods[itemClass];
    if (typeof modId !== "string") {
      stats.essencesWithoutMod.push(e.name);
      continue;
    }
    const names = forced.get(modId) ?? [];
    names.push(e.name);
    forced.set(modId, names);
  }
  return forced;
}

function essenceRecordsForClass(essences: Record<string, RawEssence>, itemClass: string, modIds: ReadonlySet<string>, stats: ClassStats): EssenceRecord[] {
  const out: EssenceRecord[] = [];
  for (const [id, e] of Object.entries(essences)) {
    if (!Object.hasOwn(e.mods, itemClass)) continue;
    const modId = e.mods[itemClass];
    if (typeof modId !== "string") continue; // already counted in essencesWithoutMod
    if (!modIds.has(modId)) {
      stats.essencesDangling.push(`${e.name} -> ${modId}`);
      continue;
    }
    out.push({
      id,
      name: e.name,
      level: e.level,
      tier: e.type.tier,
      is_corruption_only: e.type.is_corruption_only,
      item_level_restriction: e.item_level_restriction,
      spawn_level_min: e.spawn_level_min,
      mod_id: modId,
    });
  }
  return out;
}

/** Returns null when the class has no rollable mod on any of its bases. */
function buildClassFile(itemClass: string, classBases: readonly RawBaseEntry[], ctx: BuildContext): ClassBuild | null {
  const stats: ClassStats = {
    itemClass,
    bases: classBases.length,
    tagSets: 0,
    mods: 0,
    rollableMods: 0,
    essences: 0,
    bench: 0,
    forcedEssenceOnly: [],
    forcedRegular: [],
    forcedOtherwiseExcluded: [],
    essencesWithoutMod: [],
    essencesDangling: [],
    nullRequirementBases: 0,
    nullTextMods: 0,
    gzBytes: 0,
    craftedMods: 0,
    unveiledMods: 0,
    influenceMods: 0,
    elevatedMods: 0,
    implicitMods: 0,
  };

  // Distinct tag arrays among the bases, in order of first appearance.
  const tagSetIndex = new Map<string, number>();
  const tagSetDrafts: { tags: string[]; base_ids: string[] }[] = [];
  const bases: BaseRecord[] = classBases.map((entry) => {
    const key = JSON.stringify(entry.raw.tags);
    let idx = tagSetIndex.get(key);
    if (idx === undefined) {
      idx = tagSetDrafts.length;
      tagSetIndex.set(key, idx);
      tagSetDrafts.push({ tags: entry.raw.tags, base_ids: [] });
    }
    at(tagSetDrafts, idx).base_ids.push(entry.id);
    if (entry.raw.requirements == null) stats.nullRequirementBases++;
    return toBaseRecord(entry, idx);
  });

  // Weight of every candidate on every tag set, with the engine's own resolvers. Essence-only mods
  // are 0 by construction, mirroring pool.ts (`weight: m.is_essence_only ? 0 : w`), not merely
  // because their spawn_weights happen to be all-zero today.
  const rawWeights: number[][] = tagSetDrafts.map(({ tags }) => {
    const tagSet = new Set(tags);
    return ctx.candidates.map((c) =>
      c.raw.is_essence_only ? 0 : resolveWeight(c.raw.spawn_weights, tagSet) * resolveGenMultiplier(c.raw.generation_weights, tagSet),
    );
  });
  const rollsSomewhere = (ci: number): boolean => rawWeights.some((w) => (w[ci] ?? 0) > 0);

  // Select mods: rollable on some tag set, or forced by an essence on this class. Keep mods.json order.
  const forced = forcedModsForClass(ctx.essences, itemClass, stats);
  const selected: number[] = [];
  ctx.candidates.forEach((c, ci) => {
    const rollable = rollsSomewhere(ci);
    const essences = forced.get(c.id);
    if (essences) (c.raw.is_essence_only ? stats.forcedEssenceOnly : stats.forcedRegular).push(c.id);
    if (!rollable && !essences) return;
    if (!rollable && essences) stats.forcedOtherwiseExcluded.push({ id: c.id, essenceOnly: c.raw.is_essence_only, essences });
    if (rollable) stats.rollableMods++;
    selected.push(ci);
  });
  if (stats.rollableMods === 0) return null;

  const mods: ModRecord[] = selected.map((ci) => toModRecord(at(ctx.candidates, ci)));
  stats.nullTextMods = selected.filter((ci) => at(ctx.candidates, ci).raw.text == null).length;
  const modIds = new Set(mods.map((m) => m.id));

  const tag_sets: TagSetRecord[] = tagSetDrafts.map((draft, ti) => {
    const weights = selected.map((ci) => at(at(rawWeights, ti), ci));
    return { tags: draft.tags, base_ids: draft.base_ids, weights, tiers: buildTierLadders(mods, weights) };
  });

  const essences = essenceRecordsForClass(ctx.essences, itemClass, modIds, stats);
  const bench = ctx.bench.filter((b) => b.item_classes.includes(itemClass));

  // Milestone 3 lists (matched by name and text by the parser; the engine never rolls them).
  const influence_tags = ctx.itemClasses[itemClass]?.influence_tags ?? [];
  const implicit_mods = implicitModsForClass(ctx.mods, bases, itemClass);
  const crafted_mods = craftedModsForClass(ctx.mods, bench, itemClass);
  const unveiled_mods = unveiledModsForClass(ctx.mods, tagSetDrafts);
  const influence_mods = influenceModsForClass(ctx.candidates, modIds, influence_tags);

  stats.tagSets = tag_sets.length;
  stats.mods = mods.length;
  stats.essences = essences.length;
  stats.bench = bench.length;
  stats.craftedMods = crafted_mods.length;
  stats.unveiledMods = unveiled_mods.length;
  stats.influenceMods = influence_mods.length;
  stats.elevatedMods = influence_mods.filter((m) => m.elevated).length;
  stats.implicitMods = Object.keys(implicit_mods).length;

  const file: PoolFile = {
    schema: 2,
    generated: ctx.generated,
    source: ctx.source,
    item_class: itemClass,
    influence_tags,
    bases,
    mods,
    tag_sets,
    essences,
    bench,
    fossils: ctx.fossils,
    implicit_mods,
    crafted_mods,
    unveiled_mods,
    influence_mods,
    veiled_mods: ctx.veiled,
  };
  return { file, stats };
}

function logClassBuild({ stats }: ClassBuild): void {
  const s = stats;
  console.log(
    `  ${s.itemClass}: ${s.bases} bases, ${s.tagSets} tag sets, ${s.mods} mods (${s.rollableMods} rollable, ${s.mods - s.rollableMods} essence-forced only), ${s.essences} essences, ${s.bench} bench options`,
  );
  const excludedEo = s.forcedOtherwiseExcluded.filter((f) => f.essenceOnly).length;
  const excludedRegular = s.forcedOtherwiseExcluded.filter((f) => !f.essenceOnly);
  console.log(
    `      essence-forced mods: ${s.forcedEssenceOnly.length + s.forcedRegular.length} (${s.forcedEssenceOnly.length} essence-only, ${s.forcedRegular.length} regular); ` +
      `otherwise excluded: ${s.forcedOtherwiseExcluded.length} (${excludedEo} essence-only, ${excludedRegular.length} regular)`,
  );
  if (excludedRegular.length) {
    console.log(`      regular mods kept only because an essence forces them: ${excludedRegular.map((f) => `${f.id} (${f.essences.join(", ")})`).join(", ")}`);
  }
  if (s.essencesWithoutMod.length) console.log(`      essences with no forced mod for this class (skipped): ${[...new Set(s.essencesWithoutMod)].join(", ")}`);
  if (s.essencesDangling.length) console.log(`      WARNING essences whose forced mod is not in mods.json (dropped): ${s.essencesDangling.join(", ")}`);
  if (s.nullRequirementBases) console.log(`      bases with requirements: null in RePoE (copied verbatim): ${s.nullRequirementBases}`);
  if (s.nullTextMods) console.log(`      WARNING mods with text: null written as "": ${s.nullTextMods}`);
  console.log(
    `      parser lists: ${s.craftedMods} crafted, ${s.unveiledMods} unveiled, ${s.influenceMods} influence (${s.elevatedMods} elevated), ${s.implicitMods} implicit mods`,
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function gzipJson(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 });
}

function readPoolFile(path: string): PoolFile {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as PoolFile;
}

/**
 * Royale-mode copies of ordinary bases (ids like "Metadata/Items/Belts/BeltRoyale1"). They stay in
 * the class files but are left out of index.json so the UI never offers one. The id is the reliable
 * marker: eight of the ten carry the not_for_sale tag, Crude Bow's and Driftwood Wand's copies do
 * not, and the Fishing Rod carries the tag without being a copy.
 */
const isRoyaleCopy = (b: BaseRecord): boolean => /Royale/.test(b.id);

const OTHER_MODS_FILE = "other_mods.json.gz";

function buildIndex(
  builds: readonly ClassBuild[],
  generated: string,
  source: PoolFile["source"],
  itemClasses: Record<string, RawItemClass>,
  otherModCount: number,
): DataIndex {
  return {
    schema: 2,
    generated,
    source,
    classes: builds.map(({ file }) => {
      const name = itemClasses[file.item_class]?.name;
      if (!name) throw new Error(`item_classes.json has no display name for ${file.item_class}`);
      return {
        item_class: file.item_class,
        name,
        file: poolFileName(file.item_class),
        bases: file.bases.length,
        mods: file.mods.length,
      };
    }),
    other_mods: { file: OTHER_MODS_FILE, mods: otherModCount },
    bases: builds.flatMap(({ file }) =>
      file.bases.filter((b) => !isRoyaleCopy(b)).map((b) => ({ name: b.name, id: b.id, item_class: b.item_class, drop_level: b.drop_level })),
    ),
  };
}

function removeStaleFiles(produced: ReadonlySet<string>): void {
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.endsWith(".json.gz") || produced.has(name) || name === OTHER_MODS_FILE) continue;
    unlinkSync(resolve(OUT_DIR, name));
    console.log(`  removed stale ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Self-checks
// ---------------------------------------------------------------------------

/**
 * The runtime buildPool must reproduce the pre-resolved tag-set weights and tier ladders exactly:
 * same rollable set, same weight per mod, same tier per mod (at CHECK_ILVL, where every mod is in).
 */
function verifyAgainstRuntime(file: PoolFile): void {
  for (const base of file.bases) {
    const where = `${file.item_class} / ${base.name}`;
    const tagSet = file.tag_sets[base.tag_set];
    if (!tagSet) throw new Error(`${where}: tag_set ${base.tag_set} does not exist`);
    if (tagSet.weights.length !== file.mods.length) throw new Error(`${where}: weights has ${tagSet.weights.length} entries for ${file.mods.length} mods`);

    const { pool } = buildPool(file, base, CHECK_ILVL);
    const rollable = new Set<number>();
    for (const p of pool) {
      if (p.essenceOnly) continue;
      const w = tagSet.weights[p.index];
      if (w !== p.weight) throw new Error(`${where}: ${p.id} runtime weight ${p.weight} != tag-set weight ${w}`);
      rollable.add(p.index);
    }
    tagSet.weights.forEach((w, i) => {
      if (w > 0 !== rollable.has(i)) {
        throw new Error(`${where}: ${at(file.mods, i).id} has tag-set weight ${w} but is ${rollable.has(i) ? "" : "not "}rollable at ilvl ${CHECK_ILVL}`);
      }
    });

    const tierByIndex = new Map<number, number>();
    for (const [key, ladder] of Object.entries(tagSet.tiers)) {
      let rank = 0;
      let previousLevel = Number.POSITIVE_INFINITY;
      for (const i of ladder) {
        const m = at(file.mods, i);
        if (tierKey(m) !== key) throw new Error(`${where}: ${m.id} sits in ladder ${key} but belongs to ${tierKey(m)}`);
        if (!rollable.has(i)) throw new Error(`${where}: ${m.id} is in ladder ${key} but is not rollable`);
        if (m.required_level > previousLevel) throw new Error(`${where}: ladder ${key} is not sorted by required_level descending at ${m.id}`);
        previousLevel = m.required_level;
        if (m.required_level <= CHECK_ILVL) tierByIndex.set(i, ++rank);
      }
    }
    for (const p of pool) {
      if (p.essenceOnly) continue;
      const ladderTier = tierByIndex.get(p.index);
      if (ladderTier !== p.tier) throw new Error(`${where}: ${p.id} runtime tier ${p.tier} != ladder tier ${ladderTier ?? "absent"}`);
    }
    if (tierByIndex.size !== rollable.size) throw new Error(`${where}: ladders cover ${tierByIndex.size} mods, pool has ${rollable.size} rollable`);
  }
}

function tierLadder(pool: readonly PoolMod[], group: string, side: "prefix" | "suffix"): PoolMod[] {
  const rank = (p: PoolMod): number => (p.tier ?? Number.MAX_SAFE_INTEGER) * 2 + (p.essenceOnly ? 1 : 0);
  return pool.filter((p) => p.group === group && p.side === side).sort((a, b) => rank(a) - rank(b));
}

function describeTier(p: PoolMod): string {
  return `T${p.tier ?? "?"} L${p.level} ${p.text}${p.essenceOnly ? " (essence-only)" : ` (w${p.weight})`}`;
}

interface TierExpectation {
  tier: number;
  level: number;
  min: number;
  max: number;
  text?: string;
}

function expectTier(file: PoolFile, ladder: readonly PoolMod[], label: string, want: TierExpectation, problems: string[]): void {
  const p = ladder.find((m) => !m.essenceOnly && m.tier === want.tier);
  if (!p) {
    problems.push(`${label} T${want.tier}: no rollable mod at that tier`);
    return;
  }
  const stat = at(file.mods, p.index).stats[0];
  const got = `L${p.level} ${stat ? `${stat.min}-${stat.max}` : "no stats"} "${p.text}"`;
  if (p.level !== want.level) problems.push(`${label} T${want.tier}: expected L${want.level}, got ${got}`);
  if (!stat || stat.min !== want.min || stat.max !== want.max) problems.push(`${label} T${want.tier}: expected ${want.min}-${want.max}, got ${got}`);
  if (want.text !== undefined && p.text !== want.text) problems.push(`${label} T${want.tier}: expected text "${want.text}", got ${got}`);
}

/** BRIEF.md §7.1. Prints both ladders POC-style and returns the list of mismatches (empty = pass). */
function checkAstralPlate(file: PoolFile): string[] {
  const problems: string[] = [];
  const base = findBase(file, "Astral Plate");
  const { pool } = buildPool(file, base, 86);
  const rollable = pool.filter((p) => !p.essenceOnly).length;
  console.log(`\nBRIEF.md §7.1 check — ${base.name} ilvl 86 (${file.item_class}): ${rollable} rollable mods in pool`);
  if (rollable !== 109) problems.push(`expected 109 rollable mods, got ${rollable}`);

  const life = tierLadder(pool, "IncreasedLife", "prefix");
  const fire = tierLadder(pool, "FireResistance", "suffix");
  console.log(`\nLife prefixes on this base:\n   ${life.map(describeTier).join("\n   ")}`);
  console.log(`\nFire res suffixes on this base:\n   ${fire.map(describeTier).join("\n   ")}`);

  expectTier(file, life, "life", { tier: 1, level: 86, min: 175, max: 189, text: "+(175-189) to maximum Life" }, problems);
  expectTier(file, life, "life", { tier: 2, level: 81, min: 160, max: 174 }, problems);
  expectTier(file, fire, "fire res", { tier: 1, level: 84, min: 46, max: 48 }, problems);
  return problems;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fmtInt(n: number): string {
  return n.toLocaleString("en-AU");
}

function printSummary(builds: readonly ClassBuild[], indexBytes: number, modsLastModified: string | null): void {
  const cols: [string, number, "left" | "right"][] = [
    ["item class", 26, "left"],
    ["bases", 6, "right"],
    ["tag sets", 9, "right"],
    ["mods", 6, "right"],
    ["essences", 9, "right"],
    ["bench", 6, "right"],
    ["gz bytes", 11, "right"],
  ];
  const row = (cells: readonly string[]): string =>
    cells.map((c, i) => (at(cols, i)[2] === "left" ? c.padEnd(at(cols, i)[1]) : c.padStart(at(cols, i)[1]))).join("  ");
  console.log(`\nSummary:\n${row(cols.map((c) => c[0]))}`);
  console.log(row(cols.map((c) => "-".repeat(c[1]))));
  let totalGz = 0;
  for (const { stats: s } of builds) {
    totalGz += s.gzBytes;
    console.log(row([s.itemClass, fmtInt(s.bases), fmtInt(s.tagSets), fmtInt(s.mods), fmtInt(s.essences), fmtInt(s.bench), fmtInt(s.gzBytes)]));
  }
  console.log(row(cols.map((c) => "-".repeat(c[1]))));
  console.log(`${builds.length} class files, ${fmtInt(totalGz)} bytes gzipped; index.json ${fmtInt(indexBytes)} bytes; public/data total ${fmtInt(totalGz + indexBytes)} bytes`);
  console.log(`mods.json Last-Modified: ${modsLastModified ?? "(no header)"}`);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Checked index (noUncheckedIndexedAccess): throws instead of returning undefined. */
function at<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new Error(`index ${i} out of range (length ${list.length})`);
  return value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const flags = [opts.offline ? "--offline" : "", opts.refresh ? "--refresh" : ""].filter(Boolean).join(" ");
  console.log(`build-data ${flags}\nRePoE files (${REPOE}):`);
  const data = await loadRepoeData(opts);

  // Stamp the output with the data's version (newest Last-Modified among the inputs), not the run
  // time, so a re-run over unchanged data rewrites byte-identical files and dirties nothing.
  let generated: string;
  if (data.dataLastModified) {
    generated = new Date(data.dataLastModified).toISOString();
  } else {
    generated = new Date().toISOString();
    console.log("\n  WARNING: no input carried a Last-Modified header; stamping the files with the run time instead");
  }
  const source: PoolFile["source"] = { repoe: REPOE, mods_last_modified: data.modsLastModified, data_last_modified: data.dataLastModified };
  const candidates = itemPrefixSuffixMods(data.mods);
  console.log(`\nmods.json: ${fmtInt(Object.keys(data.mods).length)} mods, ${fmtInt(candidates.length)} item-domain prefix/suffix candidates`);
  console.log(`data version (generated): ${generated} from Last-Modified ${data.dataLastModified ?? "(none)"}`);
  const fossils = selectFossils(data.fossils);
  const veiled = veiledMods(data.mods);
  const ctx: BuildContext = {
    generated,
    source,
    candidates,
    mods: data.mods,
    itemClasses: data.itemClasses,
    essences: data.essences,
    bench: data.bench,
    fossils,
    veiled,
  };

  // Build every class.
  console.log("\nClasses:");
  const builds: ClassBuild[] = [];
  const skipped: string[] = [];
  const placeholders: string[] = [];
  for (const [itemClass, classBases] of releasedBasesByClass(data.bases)) {
    // item_classes.json gives HiddenItem (55 "Random One Hand Sword"-style gamble/idol placeholders)
    // a null category. They meet the "released item base + rollable mod" rule mechanically but can
    // never be pasted or crafted, so they get no file and no index entries.
    if ((data.itemClasses[itemClass]?.category ?? null) === null) {
      placeholders.push(`${itemClass} (${classBases.length} bases)`);
      continue;
    }
    const build = buildClassFile(itemClass, classBases, ctx);
    if (!build) {
      skipped.push(`${itemClass} (${classBases.length} bases)`);
      continue;
    }
    logClassBuild(build);
    builds.push(build);
  }
  if (placeholders.length) console.log(`  skipped (item_classes.json category null, placeholder bases): ${placeholders.join(", ")}`);
  if (skipped.length) console.log(`  skipped (no rollable mod on any base): ${skipped.join(", ")}`);

  // Write.
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`\nWriting ${OUT_DIR}:`);
  const produced = new Set<string>();
  for (const build of builds) {
    const name = poolFileName(build.file.item_class);
    const gz = gzipJson(build.file);
    writeFileSync(resolve(OUT_DIR, name), gz);
    build.stats.gzBytes = gz.byteLength;
    produced.add(name);
  }
  const other: OtherModsFile = { schema: 2, generated, source, mods: otherMods(data.mods, builds) };
  const otherGz = gzipJson(other);
  writeFileSync(resolve(OUT_DIR, OTHER_MODS_FILE), otherGz);
  const index = buildIndex(builds, generated, source, data.itemClasses, other.mods.length);
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;
  writeFileSync(resolve(OUT_DIR, "index.json"), indexJson);
  const royale = builds.flatMap(({ file }) => file.bases.filter(isRoyaleCopy));
  console.log(`  wrote ${produced.size} class files and index.json (${fmtInt(index.bases.length)} bases; ${royale.length} Royale copies left out: ${royale.map((b) => b.name).join(", ")})`);
  const otherByDomain = new Map<string, number>();
  for (const m of other.mods) otherByDomain.set(m.domain, (otherByDomain.get(m.domain) ?? 0) + 1);
  console.log(
    `  wrote ${OTHER_MODS_FILE}: ${fmtInt(other.mods.length)} equipment-domain mods no class file lists (${[...otherByDomain.entries()].map(([d, n]) => `${d} ${n}`).join(", ")}), ${fmtInt(otherGz.byteLength)} bytes gzipped`,
  );
  removeStaleFiles(produced);

  // Self-checks on the re-read files.
  console.log("\nSelf-checks:");
  const reread = new Map<string, PoolFile>();
  for (const build of builds) {
    const path = resolve(OUT_DIR, poolFileName(build.file.item_class));
    const file = readPoolFile(path);
    if (file.schema !== 2 || file.item_class !== build.file.item_class || file.mods.length !== build.file.mods.length) {
      throw new Error(`round trip of ${path} does not match what was written`);
    }
    reread.set(file.item_class, file);
  }
  console.log(`  round trip: ${reread.size} files gunzipped and parsed`);
  checkInfluenceNames(builds);
  const otherReread = JSON.parse(gunzipSync(readFileSync(resolve(OUT_DIR, OTHER_MODS_FILE))).toString("utf8")) as OtherModsFile;
  if (otherReread.schema !== 2 || otherReread.mods.length !== other.mods.length) throw new Error(`round trip of ${OTHER_MODS_FILE} does not match what was written`);
  let basesChecked = 0;
  for (const file of reread.values()) {
    verifyAgainstRuntime(file);
    basesChecked += file.bases.length;
  }
  console.log(`  consistency: buildPool at ilvl ${CHECK_ILVL} agrees with tag-set weights and tier ladders for ${fmtInt(basesChecked)} bases`);

  printSummary(builds, Buffer.byteLength(indexJson), data.modsLastModified);

  const bodyArmour = reread.get("Body Armour");
  if (!bodyArmour) throw new Error("Body Armour file was not built; cannot run the Astral Plate check");
  const problems = checkAstralPlate(bodyArmour);
  if (problems.length) {
    console.log(`\nCHECK FAILED: Astral Plate ilvl 86\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nCHECK PASSED: Astral Plate ilvl 86 — 109 rollable mods; life T1 175-189 (L86), T2 160-174 (L81); fire res T1 46-48 (L84)");
}

main().catch((err: unknown) => {
  console.error(`\nBUILD FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
