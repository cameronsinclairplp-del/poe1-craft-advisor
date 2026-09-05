// Node-only helpers for the data-backed tests (tsconfig.node.json): load the generated
// public/data files, the fixed parity scenarios and the POC's recorded numbers.
//
// Everything is read from disk relative to this file, so the tests work from any cwd. Pool files
// are gunzipped and parsed once and then shared: the parity suite asks for the same Body Armour
// file five times.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { poolFileName } from "../../src/engine/types.ts";
import type { DataIndex, OtherModsFile, PoolFile, Target } from "../../src/engine/types.ts";
import { detectItemClass, parseItem } from "../../src/parse/itemText.ts";
import type { Item } from "../../src/parse/itemText.ts";

/** Repository root (this file lives in test/helpers). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = resolve(ROOT, "public", "data");
export const SCENARIOS_PATH = resolve(ROOT, "test", "parity", "scenarios.json");
export const POC_RESULTS_PATH = resolve(ROOT, "poc", "results.json");
export const FIXTURES_DIR = resolve(ROOT, "test", "fixtures", "items");

// ---------------------------------------------------------------------------
// public/data
// ---------------------------------------------------------------------------

let indexCache: DataIndex | undefined;

/** public/data/index.json, parsed once. */
export function loadIndex(): DataIndex {
  if (!indexCache) {
    indexCache = JSON.parse(readFileSync(resolve(DATA_DIR, "index.json"), "utf8")) as DataIndex;
  }
  return indexCache;
}

const fileCache = new Map<string, PoolFile>();

/** Read, gunzip and parse public/data/<Item_Class>.json.gz. Cached per file. */
export function loadPoolFileByClass(itemClass: string): PoolFile {
  const name = poolFileName(itemClass);
  let file = fileCache.get(name);
  if (!file) {
    file = JSON.parse(gunzipSync(readFileSync(resolve(DATA_DIR, name))).toString("utf8")) as PoolFile;
    fileCache.set(name, file);
  }
  return file;
}

/**
 * The pool file that holds a base, looked up by display name through index.json. Throws if the
 * name is unknown or if bases with that name sit in more than one item class. One name does today:
 * "Energy Blade" (One Hand Sword and Two Hand Sword), so a scenario on it would need an item class
 * argument; the POC's findBase would silently take the One Hand Sword one. None of the parity
 * scenarios use an ambiguous name.
 */
export function loadPoolFileFor(baseName: string): PoolFile {
  const classes = new Set(loadIndex().bases.filter((b) => b.name === baseName).map((b) => b.item_class));
  if (classes.size === 0) throw new Error(`base not found in public/data/index.json: ${baseName}`);
  if (classes.size > 1) throw new Error(`base name ${baseName} is ambiguous across item classes: ${[...classes].join(", ")}`);
  const [itemClass] = classes;
  if (itemClass === undefined) throw new Error("unreachable: non-empty set yielded no item class");
  return loadPoolFileByClass(itemClass);
}

let otherCache: OtherModsFile | undefined;

/** public/data/other_mods.json.gz, parsed once. */
export function loadOtherMods(): OtherModsFile {
  if (!otherCache) {
    const name = loadIndex().other_mods.file;
    otherCache = JSON.parse(gunzipSync(readFileSync(resolve(DATA_DIR, name))).toString("utf8")) as OtherModsFile;
  }
  return otherCache;
}

// ---------------------------------------------------------------------------
// test/fixtures/items/*.txt — real Ctrl+Alt+C pastes
// ---------------------------------------------------------------------------

/**
 * A fixture is the pasted text with a few leading "#" comment lines:
 *   # source: <url>                       where the paste was found (required)
 *   # note: <free text>                   what it covers
 *   # expect-error: <ErrorClassName>      the parser must throw this (jewels, flasks, ...)
 * Drop a new .txt into test/fixtures/items and the fixture suite picks it up.
 */
export interface Fixture {
  name: string;
  path: string;
  text: string;
  source: string | null;
  note: string | null;
  expectError: string | null;
}

/** Fixture file names (without .txt), sorted. */
export function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.slice(0, -4))
    .sort();
}

export function readFixture(name: string): Fixture {
  const path = resolve(FIXTURES_DIR, `${name}.txt`);
  const text = readFileSync(path, "utf8");
  const directive = (key: string): string | null => {
    const m = new RegExp(`^# ${key}: (.+)$`, "m").exec(text);
    return m?.[1]?.trim() ?? null;
  };
  return { name, path, text, source: directive("source"), note: directive("note"), expectError: directive("expect-error") };
}

/** detectItemClass + the right class file + parseItem, the way the UI will do it. */
export function parseItemFromText(text: string): Item {
  const index = loadIndex();
  const detected = detectItemClass(text, index);
  return parseItem(text, { index, classFile: loadPoolFileByClass(detected.itemClass), otherMods: loadOtherMods() });
}

// ---------------------------------------------------------------------------
// test/parity/scenarios.json
// ---------------------------------------------------------------------------

export type ScenarioMethod = { kind: "chaos" } | { kind: "alch" } | { kind: "essence"; essence: string };

export interface Scenario {
  id: string;
  base: string;
  ilvl: number;
  method: ScenarioMethod;
  /** Monte Carlo rolls; absent means the file-level default (200,000 in the POC). */
  sims?: number;
  target: Target;
  coe_setup: string;
  /** Craft of Exile's per-attempt probability. null = PENDING (not filled in yet), never a failure. */
  coe_p: number | null;
}

export interface ScenariosFile {
  _readme: string[];
  league: string;
  scenarios: Scenario[];
}

/** The fixed parity scenarios. Never edited by tests. */
export function loadScenarios(): ScenariosFile {
  return JSON.parse(readFileSync(SCENARIOS_PATH, "utf8")) as ScenariosFile;
}

// ---------------------------------------------------------------------------
// poc/results.json
// ---------------------------------------------------------------------------

export interface PocResult {
  id: string;
  /** Per-attempt probability, rounded to 6 decimals by the POC. */
  poc_p: number;
  /** 1.96 * sqrt(p(1-p)/sims), absolute, rounded to 6 decimals. */
  ci95_abs: number;
  hits: number;
  sims: number;
  exp_attempts: number;
  cost_per_attempt_c: number;
  exp_cost_c: number;
  /** "<text> (T<tier>)" per forced mod. */
  forced: string[];
}

export interface PocResultsFile {
  generated: string;
  league: string;
  /** The POC's default sims; scenarios with their own `sims` override it. */
  sims: number;
  divine_chaos: number;
  results: PocResult[];
}

/** The POC's recorded numbers for the parity scenarios. */
export function loadPocResults(): PocResultsFile {
  return JSON.parse(readFileSync(POC_RESULTS_PATH, "utf8")) as PocResultsFile;
}

/** The POC row for a scenario id. Throws if the POC never ran that scenario. */
export function pocResultFor(results: PocResultsFile, id: string): PocResult {
  const hit = results.results.find((r) => r.id === id);
  if (!hit) throw new Error(`poc/results.json has no entry for scenario ${id}`);
  return hit;
}
