// scripts/snapshot-prices.ts — poe.ninja -> public/prices/<league>.json
//
// Usage:
//   npm run snapshot-prices                          # league Allflame
//   npm run snapshot-prices -- --league Standard
//   npm run snapshot-prices -- --force               # ignore the 30-minute guard, revalidate every URL
//
// poe.ninja etiquette (CLAUDE.md ground rule 6, BRIEF.md section 4):
//   - documented PoE 1 economy endpoints only (/poe1/api/economy/...); the old /api/data/... are dead
//   - descriptive User-Agent
//   - never poll faster than every 30 minutes: if the snapshot for this league is under 30 minutes
//     old the script exits without a single network call (unless --force). A fail-soft run also arms
//     the guard (its attempts did hit poe.ninja); the guard message says so when sections are stale.
//   - respect Cache-Control and ETag: bodies are cached in .cache/ninja/<type>.json with their ETag in
//     .cache/ninja/etags.json; every request sends If-None-Match and a 304 reuses the cached body; a
//     cached body younger than the response's max-age is reused without a request (unless --force).
//     In GitHub Actions the workflow restores .cache/ninja from the previous run for the same reason.
//   - requests are strictly sequential with a 250 ms pause between them; no parallel bursts
//   - one retry after 2 s on network errors, 408 and 5xx; 429 and 503 wait for Retry-After (up to
//     60 s) or are not retried; other 4xx are never retried
//   - the browser never calls poe.ninja: it reads the snapshot this script commits
//
// Fail soft (BRIEF.md section 8 risk 4): if an endpoint fails (network error, non-2xx, unexpected
// body shape, an EMPTY body, or a body with under half as many priced lines as the previous
// snapshot's section) that section is carried over from the previous snapshot with stale: true and
// its old fetched timestamp, a WARNING is printed and the file is still written. Exit 1 only if a
// failed section has no previous data to fall back on (then nothing is written). A rejected body
// is never cached, so a persistently bad feed stays stale run after run; --force skips the
// "under half" check for the case where the market really did shrink.
//
// Every successful run rewrites the file (generated and each section's fetched move even on a
// 304), so the cron workflow commits on every run that reaches the network.
//
// Console timestamps are DD/MM/YYYY HH:MM (24-hour, local time); the file holds ISO 8601.

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type {
  BaseTypeLine,
  BaseTypeSection,
  ExchangeSectionKey,
  PriceEntry,
  PriceSection,
  PriceSnapshot,
} from "../src/prices/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(ROOT, ".cache", "ninja");
const ETAGS_PATH = resolve(CACHE_DIR, "etags.json");
const OUT_DIR = resolve(ROOT, "public", "prices");

const NINJA = "https://poe.ninja/poe1/api/economy";
const USER_AGENT = "poe1-craft-advisor snapshot-prices/0.1 (+https://github.com/cameronsinclairplp-del/poe1-craft-advisor)";

/** Do not poll poe.ninja faster than this (matches their Cache-Control max-age of 1800 s). */
const GUARD_MS = 30 * 60_000;
/** Pause between consecutive requests. */
const PAUSE_MS = 250;
/** Pause before the single retry of a failed request (network error, 408, 5xx without Retry-After). */
const RETRY_PAUSE_MS = 2_000;
/** Longest Retry-After we are willing to honour before giving the section up as stale. */
const MAX_RETRY_AFTER_MS = 60_000;
/** Per-request timeout. BaseType is about 8.5 MB. */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * A new section with fewer than this fraction of the previous section's priced lines is treated as
 * a bad body (poe.ninja gives no stability guarantee). Only applied when the previous section had
 * at least MIN_LINES_FOR_PLAUSIBILITY lines, so tiny sections (4 resonators) never flap. The
 * previous section counts whether or not it is stale: a carried-over section holds the last
 * known-good counts. --force skips the check.
 */
const PLAUSIBILITY_FRACTION = 0.5;
const MIN_LINES_FOR_PLAUSIBILITY = 10;

const EXCHANGE_TYPES: { key: ExchangeSectionKey; type: string }[] = [
  { key: "currency", type: "Currency" },
  { key: "essence", type: "Essence" },
  { key: "fossil", type: "Fossil" },
  { key: "resonator", type: "Resonator" },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** DD/MM/YYYY HH:MM, 24-hour, local time (CLAUDE.md conventions). */
function fmtLocal(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "invalid date";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return `${Math.floor(ms / 1000)} s`;
  if (min < 120) return `${min} min`;
  return `${(min / 60).toFixed(1)} h`;
}

const fmtInt = (n: number) => n.toLocaleString("en-AU");

function exchangeUrl(league: string, type: string): string {
  return `${NINJA}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
}
function baseTypeUrl(league: string): string {
  return `${NINJA}/stash/current/item/overview?league=${encodeURIComponent(league)}&type=BaseType`;
}
const LEAGUES_URL = `${NINJA}/leagues`;

/** Write to a sibling temp file and rename so a killed process never leaves a torn file behind. */
async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** A response body that does not have the shape we expect. Retrying will not help. */
class ShapeError extends Error {}

/** A non-2xx response. `retryAfterMs` is the parsed Retry-After header, if any. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`HTTP ${status} ${statusText}`.trim());
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Retry policy. Returns how long to wait before the single retry, or null for "do not retry".
 * Network errors (fetch failed, timeout), 408 and 5xx: 2 s. 429 and 503 with a Retry-After of at
 * most 60 s: that long; with a longer or missing Retry-After: give up (the section falls back).
 * Any other 4xx and every ShapeError: give up, the same answer would come back.
 */
function retryDelayMs(err: unknown): number | null {
  if (err instanceof ShapeError) return null;
  if (!(err instanceof HttpError)) return RETRY_PAUSE_MS; // network error, abort/timeout, JSON parse of a 200
  if (err.status === 429 || err.status === 503) {
    if (err.retryAfterMs === null) return err.status === 503 ? RETRY_PAUSE_MS : null;
    return err.retryAfterMs <= MAX_RETRY_AFTER_MS ? err.retryAfterMs : null;
  }
  if (err.status === 408 || err.status >= 500) return RETRY_PAUSE_MS;
  return null;
}

// ---------------------------------------------------------------------------
// ETag + body cache
// ---------------------------------------------------------------------------

interface EtagRecord {
  /** The response's ETag, sent back verbatim as If-None-Match (poe.ninja's are weak: W/...). */
  etag: string;
  /** Body cache file name under .cache/ninja, e.g. "Currency.json". */
  file: string;
  /** ISO 8601: when the body was fetched or last revalidated. */
  fetched: string;
  /** Cache-Control max-age in seconds, if the response carried one. */
  max_age: number | null;
}

/** URL -> record. One body file serves one URL: storing a 200 for a URL evicts other URLs sharing its file. */
type EtagStore = Record<string, EtagRecord>;

async function loadEtagStore(): Promise<EtagStore> {
  if (!existsSync(ETAGS_PATH)) return {};
  try {
    const parsed: unknown = JSON.parse(await readFile(ETAGS_PATH, "utf8"));
    if (!isRecord(parsed)) return {};
    const store: EtagStore = {};
    for (const [url, rec] of Object.entries(parsed)) {
      if (isRecord(rec) && typeof rec.etag === "string" && typeof rec.file === "string" && typeof rec.fetched === "string") {
        store[url] = { etag: rec.etag, file: rec.file, fetched: rec.fetched, max_age: isFiniteNumber(rec.max_age) ? rec.max_age : null };
      }
    }
    return store;
  } catch {
    console.log(`  note: ${ETAGS_PATH} is unreadable, starting a fresh ETag store`);
    return {};
  }
}

async function saveEtagStore(store: EtagStore): Promise<void> {
  await writeAtomic(ETAGS_PATH, JSON.stringify(store, null, 2) + "\n");
}

/**
 * Every body in .cache/ninja sits beside <type>.headers holding the headers of the 200 response it
 * came from (the hand-saved seed downloads used that layout; the script keeps it up to date on
 * every 200). If etags.json has no record for a URL but the headers file exists, seed the ETag and
 * max-age from it so the very first run can already get a 304. A seed taken from another league's
 * download is harmless: the server will not match it and simply answers 200.
 */
async function seedFromHeadersFile(file: string): Promise<{ etag: string; maxAge: number | null } | null> {
  const path = resolve(CACHE_DIR, file.replace(/\.json$/, ".headers"));
  if (!existsSync(path)) return null;
  const text = await readFile(path, "utf8");
  let etag: string | null = null;
  let maxAge: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const e = /^etag:\s*(.+?)\s*$/i.exec(line);
    if (e?.[1]) etag = e[1];
    const c = /^cache-control:\s*(.+?)\s*$/i.exec(line);
    if (c?.[1]) maxAge = parseMaxAge(c[1]);
  }
  return etag ? { etag, maxAge } : null;
}

function parseMaxAge(cacheControl: string | null): number | null {
  const m = cacheControl ? /max-age=(\d+)/i.exec(cacheControl) : null;
  return m?.[1] ? Number(m[1]) : null;
}

/** Same layout as the hand-saved <type>.headers files: a status line, then one "name: value" per line. */
function dumpHeaders(res: Response): string {
  const lines = [`HTTP/1.1 ${res.status} ${res.statusText}`.trim()];
  res.headers.forEach((value, name) => lines.push(`${name}: ${value}`));
  return lines.join("\n") + "\n";
}

interface FetchResult<T> {
  body: T;
  /** ISO 8601: when the body was fetched or revalidated. */
  fetched: string;
  /** Short description for the console. */
  how: string;
}

let requestsMade = 0;

/** Sequential, polite fetch: 250 ms pause before every request after the first. */
async function politeFetch(url: string, headers: Record<string, string>): Promise<Response> {
  if (requestsMade > 0) await sleep(PAUSE_MS);
  requestsMade++;
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });
}

/**
 * Fetch a JSON body with ETag revalidation and a body cache. `validate` turns the parsed JSON into
 * T or throws ShapeError; only validated bodies are cached. One retry per the policy in
 * retryDelayMs. A 304 whose cached body turns out unreadable drops the ETag and retries
 * unconditionally, so a torn cache file heals itself. Throws if both attempts fail.
 */
async function fetchCached<T>(
  url: string,
  file: string,
  store: EtagStore,
  force: boolean,
  validate: (body: unknown) => T,
): Promise<FetchResult<T>> {
  const bodyPath = resolve(CACHE_DIR, file);
  const haveBody = existsSync(bodyPath);
  let record = store[url];
  const now = new Date();

  // Cache-Control: a body we fetched for this URL less than max-age ago is still fresh; no request.
  if (!force && record && haveBody && record.max_age != null) {
    const ageMs = now.getTime() - Date.parse(record.fetched);
    if (ageMs >= 0 && ageMs < record.max_age * 1000) {
      try {
        const body = validate(JSON.parse(await readFile(bodyPath, "utf8")));
        return { body, fetched: record.fetched, how: `fresh per Cache-Control (age ${fmtAge(ageMs)}), reused cache` };
      } catch (err) {
        // The fresh cached body is unreadable or no longer acceptable: forget the record and go
        // to the network below (a 304 against the .headers seed heals through the 304 branch).
        console.log(`  note: cached ${file} is not usable (${err instanceof Error ? err.message : String(err)}); refetching`);
        delete store[url];
        record = undefined;
        await saveEtagStore(store);
      }
    }
  }

  // Which ETag to revalidate with: our own record, else the seed from <type>.headers.
  let etag: string | null = null;
  let seededMaxAge: number | null = null;
  if (haveBody) {
    if (record) etag = record.etag;
    else {
      const seed = await seedFromHeadersFile(file);
      if (seed) {
        etag = seed.etag;
        seededMaxAge = seed.maxAge;
        console.log(`  note: seeded ETag for ${file} from ${file.replace(/\.json$/, ".headers")}`);
      }
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      const delay = retryDelayMs(lastError);
      if (delay === null) break;
      console.log(`  retrying in ${(delay / 1000).toFixed(delay % 1000 ? 1 : 0)} s: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      await sleep(delay);
    }
    try {
      const res = await politeFetch(url, etag ? { "If-None-Match": etag } : {});
      if (res.status === 304) {
        if (!etag) {
          // A 304 is only meaningful as the answer to our If-None-Match. Never trust one otherwise.
          throw new Error("304 Not Modified without a conditional request; retrying unconditionally");
        }
        let body: T;
        try {
          body = validate(JSON.parse(await readFile(bodyPath, "utf8")));
        } catch (err) {
          // The cached body behind our ETag is unreadable (torn write, disk full). Forget the ETag
          // so the retry is unconditional and replaces it.
          etag = null;
          delete store[url];
          await saveEtagStore(store);
          throw new Error(`cached ${file} is unreadable (${err instanceof Error ? err.message : String(err)}); refetching unconditionally`);
        }
        const fetched = new Date().toISOString();
        store[url] = { etag, file, fetched, max_age: parseMaxAge(res.headers.get("cache-control")) ?? record?.max_age ?? seededMaxAge };
        await saveEtagStore(store);
        return { body, fetched, how: "304, reused cache" };
      }
      if (!res.ok) throw new HttpError(res.status, res.statusText, parseRetryAfter(res.headers.get("retry-after")));
      const text = await res.text();
      const body = validate(JSON.parse(text));
      const fetched = new Date().toISOString();
      await writeAtomic(bodyPath, text);
      // Keep <type>.headers in step with the body so the ETag seed above always describes this body.
      await writeAtomic(resolve(CACHE_DIR, file.replace(/\.json$/, ".headers")), dumpHeaders(res));
      const newEtag = res.headers.get("etag");
      // This file now holds this URL's body: drop any other URL that pointed at the same file.
      for (const [otherUrl, rec] of Object.entries(store)) if (otherUrl !== url && rec.file === file) delete store[otherUrl];
      if (newEtag) store[url] = { etag: newEtag, file, fetched, max_age: parseMaxAge(res.headers.get("cache-control")) };
      else delete store[url];
      await saveEtagStore(store);
      return { body, fetched, how: newEtag ? "200" : "200 (no ETag sent)" };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// Body validation + section building
// ---------------------------------------------------------------------------

interface ExchangeLine {
  id: string;
  primaryValue: unknown;
}
interface ExchangeBody {
  lines: ExchangeLine[];
  /** id -> name from items[]. */
  names: Map<string, string>;
}

/** Shape check for the exchange overview. An empty body is a bad body, not a valid snapshot. */
function validateExchange(body: unknown): ExchangeBody {
  if (!isRecord(body) || !Array.isArray(body.lines) || !Array.isArray(body.items)) {
    throw new ShapeError("unexpected body: expected { lines: [], items: [] }");
  }
  if (body.lines.length === 0 || body.items.length === 0) {
    throw new ShapeError(`unexpected body: ${body.lines.length} lines, ${body.items.length} items (empty)`);
  }
  const names = new Map<string, string>();
  for (const it of body.items) {
    if (isRecord(it) && typeof it.id === "string" && typeof it.name === "string") names.set(it.id, it.name);
  }
  const lines: ExchangeLine[] = [];
  for (const l of body.lines) {
    if (isRecord(l) && typeof l.id === "string") lines.push({ id: l.id, primaryValue: l.primaryValue });
  }
  return { lines, names };
}

/** The currency overview must price Chaos and Divine Orbs: divine_chaos and the unit of account depend on them. */
function validateCurrency(body: unknown): ExchangeBody {
  const v = validateExchange(body);
  for (const id of ["chaos", "divine"]) {
    const line = v.lines.find((l) => l.id === id);
    if (!line || !isFiniteNumber(line.primaryValue)) throw new ShapeError(`unexpected body: currency line "${id}" missing or unpriced`);
  }
  return v;
}

interface ExchangeBuild {
  section: PriceSection;
  lines: number;
  priced: number;
  skippedNoName: number;
  skippedBadValue: number;
  duplicateNames: number;
}

function buildExchangeSection(body: ExchangeBody, fetched: string): ExchangeBuild {
  const items: Record<string, PriceEntry> = {};
  let skippedNoName = 0;
  let skippedBadValue = 0;
  let duplicateNames = 0;
  for (const line of body.lines) {
    const name = body.names.get(line.id);
    if (name === undefined) {
      skippedNoName++;
      continue;
    }
    if (!isFiniteNumber(line.primaryValue)) {
      skippedBadValue++;
      continue;
    }
    if (name in items) duplicateNames++;
    items[name] = { id: line.id, chaos: line.primaryValue };
  }
  return {
    section: { fetched, stale: false, items },
    lines: body.lines.length,
    priced: Object.keys(items).length,
    skippedNoName,
    skippedBadValue,
    duplicateNames,
  };
}

interface BaseTypeBody {
  lines: unknown[];
}

function validateBaseType(body: unknown): BaseTypeBody {
  if (!isRecord(body) || !Array.isArray(body.lines)) throw new ShapeError("unexpected body: expected { lines: [] }");
  if (body.lines.length === 0) throw new ShapeError("unexpected body: 0 lines (empty)");
  return { lines: body.lines };
}

interface BaseTypeBuild {
  section: BaseTypeSection;
  total: number;
  kept: number;
  droppedDouble: number;
  skippedBad: number;
}

function buildBaseTypeSection(body: BaseTypeBody, fetched: string): BaseTypeBuild {
  const lines: BaseTypeLine[] = [];
  let droppedDouble = 0;
  let skippedBad = 0;
  for (const l of body.lines) {
    if (
      !isRecord(l) ||
      typeof l.name !== "string" ||
      !isFiniteNumber(l.levelRequired) ||
      !isFiniteNumber(l.chaosValue) ||
      !isFiniteNumber(l.count) ||
      !isFiniteNumber(l.listingCount) ||
      (l.variant !== undefined && l.variant !== null && typeof l.variant !== "string")
    ) {
      skippedBad++;
      continue;
    }
    const variant = typeof l.variant === "string" && l.variant !== "" ? l.variant : null;
    if (variant !== null && variant.includes("/")) {
      droppedDouble++; // double influence: out of scope until v3
      continue;
    }
    lines.push({
      name: l.name,
      level_required: l.levelRequired,
      variant,
      chaos: l.chaosValue,
      count: l.count,
      listing_count: l.listingCount,
    });
  }
  // Deterministic order: name, level_required, then variant (plain base first).
  lines.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.level_required !== b.level_required) return a.level_required - b.level_required;
    if (a.variant === b.variant) return 0;
    if (a.variant === null) return -1;
    if (b.variant === null) return 1;
    return a.variant < b.variant ? -1 : 1;
  });
  return { section: { fetched, stale: false, lines }, total: body.lines.length, kept: lines.length, droppedDouble, skippedBad };
}

function validateLeagues(body: unknown): { id: string; name: string }[] {
  if (!Array.isArray(body)) throw new ShapeError("unexpected body: expected an array of { id, name }");
  const out: { id: string; name: string }[] = [];
  for (const l of body) if (isRecord(l) && typeof l.id === "string") out.push({ id: l.id, name: typeof l.name === "string" ? l.name : l.id });
  if (out.length === 0) throw new ShapeError("unexpected body: 0 leagues (empty)");
  return out;
}

/**
 * poe.ninja gives no stability guarantee. A section that shrank to under half the previous
 * section is a bad body, not a market event; keep the previous data (stale) instead. Wrapped
 * around the shape validator so the rejection happens inside fetchCached, where a ShapeError means
 * "never cache this body, never retry it".
 */
function withPlausibility<T>(
  validate: (body: unknown) => T,
  count: (body: T) => number,
  kind: string,
  previousCount: number,
  force: boolean,
): (body: unknown) => T {
  return (raw) => {
    const body = validate(raw);
    if (!force && previousCount >= MIN_LINES_FOR_PLAUSIBILITY) {
      const n = count(body);
      if (n < previousCount * PLAUSIBILITY_FRACTION) {
        throw new ShapeError(`implausible body: ${fmtInt(n)} ${kind} vs ${fmtInt(previousCount)} in the previous snapshot`);
      }
    }
    return body;
  };
}

/** Lines the exchange builder will price: named and with a finite primaryValue. */
const pricedLineCount = (body: ExchangeBody): number =>
  body.lines.filter((l) => body.names.has(l.id) && isFiniteNumber(l.primaryValue)).length;

/** Lines the BaseType builder will keep: everything but double-influence variants. */
const keptBaseLineCount = (body: BaseTypeBody): number =>
  body.lines.filter((l) => !(isRecord(l) && typeof l.variant === "string" && l.variant.includes("/"))).length;

// ---------------------------------------------------------------------------
// Previous snapshot (guard + fallback)
// ---------------------------------------------------------------------------

function isPriceSection(v: unknown): v is PriceSection {
  return isRecord(v) && typeof v.fetched === "string" && typeof v.stale === "boolean" && isRecord(v.items);
}
function isBaseTypeSection(v: unknown): v is BaseTypeSection {
  return isRecord(v) && typeof v.fetched === "string" && typeof v.stale === "boolean" && Array.isArray(v.lines);
}

/** Loose structural check: enough to trust `generated` for the guard and each section as a fallback. */
function isPriceSnapshot(v: unknown): v is PriceSnapshot {
  return (
    isRecord(v) &&
    v.schema === 1 &&
    typeof v.league === "string" &&
    typeof v.generated === "string" &&
    isPriceSection(v.currency) &&
    isPriceSection(v.essence) &&
    isPriceSection(v.fossil) &&
    isPriceSection(v.resonator) &&
    isBaseTypeSection(v.base_types)
  );
}

async function loadPrevious(path: string): Promise<PriceSnapshot | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isPriceSnapshot(parsed)) return parsed;
    console.log(`  WARNING: ${path} does not look like a schema 1 snapshot; ignoring it (no guard, no fallback)`);
    return null;
  } catch (err) {
    console.log(`  WARNING: could not read ${path}: ${err instanceof Error ? err.message : String(err)} (no guard, no fallback)`);
    return null;
  }
}

/**
 * poe.ninja league ids are case-sensitive ("Allflame"); users are not. Before any network call,
 * match a differently-cased --league against the snapshot files already in public/prices so the
 * guard and the fallback find the right file. The leagues endpoint confirms the id afterwards.
 */
function canonicalLeagueFromDisk(league: string): string {
  if (!existsSync(OUT_DIR)) return league;
  // readdir names are case-exact even on Windows and macOS, where existsSync is not.
  const names = readdirSync(OUT_DIR);
  if (names.includes(`${league}.json`)) return league;
  const wanted = `${league}.json`.toLowerCase();
  const hit = names.find((n) => n.toLowerCase() === wanted);
  return hit ? hit.replace(/\.json$/, "") : league;
}

const staleCountOf = (s: PriceSnapshot): number => [s.currency, s.essence, s.fossil, s.resonator, s.base_types].filter((x) => x.stale).length;

/**
 * Pretty-print the snapshot but keep each BaseType line on one line: 16,000+ lines pretty-printed
 * would be 3 MB, and the file is committed every 6 hours. The result is re-parsed and compared
 * with the object before it is returned, so a serialisation slip can never reach disk.
 */
function serialiseSnapshot(snapshot: PriceSnapshot): string {
  const placeholder = "@@BASE_TYPE_LINES@@";
  const head = JSON.stringify({ ...snapshot, base_types: { ...snapshot.base_types, lines: placeholder } }, null, 2);
  const lines = snapshot.base_types.lines.map((l) => `      ${JSON.stringify(l)}`).join(",\n");
  // Function replacer: a string replacement would expand "$&", "$1" and friends inside the rows.
  const text = head.replace(`"${placeholder}"`, () => (lines.length ? `[\n${lines}\n    ]` : "[]")) + "\n";
  let back: unknown;
  try {
    back = JSON.parse(text);
  } catch (err) {
    throw new Error(`snapshot serialisation did not round-trip: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (JSON.stringify(back) !== JSON.stringify(snapshot)) throw new Error("snapshot serialisation did not round-trip");
  return text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseCli(): { league: string; force: boolean } {
  try {
    const { values } = parseArgs({
      options: {
        league: { type: "string", default: "Allflame" },
        force: { type: "boolean", default: false },
      },
      strict: true,
    });
    const league = (values.league ?? "Allflame").trim();
    if (!league) throw new Error("--league must not be empty");
    return { league, force: values.force ?? false };
  } catch (err) {
    console.error(`snapshot-prices: ${err instanceof Error ? err.message : String(err)}`);
    console.error("usage: npm run snapshot-prices [-- --league <id>] [-- --force]");
    process.exit(2);
  }
}

async function main(): Promise<number> {
  const cli = parseCli();
  let league = canonicalLeagueFromDisk(cli.league);
  const force = cli.force;
  const started = new Date();
  console.log(`snapshot-prices  league=${league}${force ? "  --force" : ""}  ${fmtLocal(started)}`);
  const warnings: string[] = [];

  // 30-minute guard (before anything touches the network).
  const underGuard = (prev: PriceSnapshot | null, path: string): boolean => {
    if (force || !prev) return false;
    const ageMs = started.getTime() - Date.parse(prev.generated);
    if (!(ageMs >= 0 && ageMs < GUARD_MS)) return false;
    const stale = staleCountOf(prev);
    console.log(
      `  ${path} was generated ${fmtLocal(prev.generated)} (${fmtAge(ageMs)} ago), under the 30-minute limit; ` +
        `no network calls made.${stale ? ` ${stale} section(s) in it are stale.` : ""} Use --force to ${stale ? "retry now" : "override"}.`,
    );
    return true;
  };
  let previous = await loadPrevious(resolve(OUT_DIR, `${league}.json`));
  if (underGuard(previous, resolve(OUT_DIR, `${league}.json`))) return 0;

  const store = await loadEtagStore();
  const pad = (s: string) => s.padEnd(12);

  // League validation: warn and continue if the call fails; stop early on an unknown id.
  try {
    const r = await fetchCached(LEAGUES_URL, "leagues.json", store, force, validateLeagues);
    const exact = r.body.find((l) => l.id === league);
    const loose = exact ?? r.body.find((l) => l.id.toLowerCase() === league.toLowerCase());
    if (!loose) {
      console.error(`  ERROR: league "${league}" is not in poe.ninja's league list: ${r.body.map((l) => l.id).join(", ")}`);
      return 1;
    }
    if (!exact) {
      console.log(`  note: using poe.ninja's league id "${loose.id}" for "${league}"`);
      league = loose.id;
      previous = await loadPrevious(resolve(OUT_DIR, `${league}.json`));
      if (underGuard(previous, resolve(OUT_DIR, `${league}.json`))) return 0;
    }
    console.log(`  ${pad("leagues")} ${r.how.padEnd(48)} ${r.body.length} leagues, "${league}" ok`);
  } catch (err) {
    const msg = `could not fetch the league list (${err instanceof Error ? err.message : String(err)}); continuing with "${league}" unvalidated`;
    warnings.push(msg);
    console.log(`  WARNING: ${msg}`);
  }
  const finalOutPath = resolve(OUT_DIR, `${league}.json`);

  const hardFailures: string[] = [];

  // Exchange sections: Currency, Essence, Fossil, Resonator.
  const sections: Partial<Record<ExchangeSectionKey, PriceSection>> = {};
  for (const { key, type } of EXCHANGE_TYPES) {
    const prev = previous?.[key];
    try {
      const shape = key === "currency" ? validateCurrency : validateExchange;
      const validate = withPlausibility(shape, pricedLineCount, "priced lines", prev ? Object.keys(prev.items).length : 0, force);
      const r = await fetchCached(exchangeUrl(league, type), `${type}.json`, store, force, validate);
      const b = buildExchangeSection(r.body, r.fetched);
      sections[key] = b.section;
      const extras: string[] = [];
      if (b.skippedBadValue) extras.push(`${b.skippedBadValue} skipped (non-numeric primaryValue)`);
      if (b.duplicateNames) extras.push(`${b.duplicateNames} duplicate name(s) overwritten`);
      console.log(
        `  ${pad(type)} ${r.how.padEnd(48)} ${b.lines} lines, ${b.priced} priced, ${b.skippedNoName} skipped (no item name)` +
          (extras.length ? `, ${extras.join(", ")}` : ""),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (prev) {
        sections[key] = { fetched: prev.fetched, stale: true, items: prev.items };
        const msg = `${type}: ${reason}; reusing the section from the previous snapshot (fetched ${fmtLocal(prev.fetched)}, marked stale)`;
        warnings.push(msg);
        console.log(`  WARNING: ${msg}`);
      } else {
        hardFailures.push(`${type}: ${reason}; no previous snapshot to fall back on`);
        console.log(`  ERROR: ${hardFailures[hardFailures.length - 1]}`);
      }
    }
  }

  // BaseType.
  let baseTypes: BaseTypeSection | null = null;
  {
    const prev = previous?.base_types;
    try {
      const validate = withPlausibility(validateBaseType, keptBaseLineCount, "base lines", prev ? prev.lines.length : 0, force);
      const r = await fetchCached(baseTypeUrl(league), "BaseType.json", store, force, validate);
      const b = buildBaseTypeSection(r.body, r.fetched);
      baseTypes = b.section;
      console.log(
        `  ${pad("BaseType")} ${r.how.padEnd(48)} ${fmtInt(b.total)} lines, ${fmtInt(b.kept)} kept, ${fmtInt(b.droppedDouble)} dropped (double influence)` +
          (b.skippedBad ? `, ${b.skippedBad} skipped (malformed)` : ""),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (prev) {
        baseTypes = { fetched: prev.fetched, stale: true, lines: prev.lines };
        const msg = `BaseType: ${reason}; reusing the section from the previous snapshot (fetched ${fmtLocal(prev.fetched)}, marked stale)`;
        warnings.push(msg);
        console.log(`  WARNING: ${msg}`);
      } else {
        hardFailures.push(`BaseType: ${reason}; no previous snapshot to fall back on`);
        console.log(`  ERROR: ${hardFailures[hardFailures.length - 1]}`);
      }
    }
  }

  const currency = sections.currency;
  const essence = sections.essence;
  const fossil = sections.fossil;
  const resonator = sections.resonator;
  if (!currency || !essence || !fossil || !resonator || !baseTypes) {
    console.error(`\n  ${hardFailures.length} section(s) have no data and no fallback; nothing written to ${finalOutPath}`);
    for (const f of hardFailures) console.error(`    - ${f}`);
    return 1;
  }

  // Divine Orb is the currency line with id "divine" (looked up by id so a stale fallback still works).
  const divineEntry = Object.values(currency.items).find((e) => e.id === "divine");
  const divineChaos = divineEntry?.chaos ?? null;
  if (divineChaos === null) console.log(`  WARNING: no Divine Orb (id "divine") in the currency section; divine_chaos is null`);

  const snapshot: PriceSnapshot = {
    schema: 1,
    league,
    generated: new Date().toISOString(),
    source: "poe.ninja",
    divine_chaos: divineChaos,
    currency,
    essence,
    fossil,
    resonator,
    base_types: baseTypes,
  };

  const text = serialiseSnapshot(snapshot);
  await writeAtomic(finalOutPath, text);
  const bytes = Buffer.byteLength(text, "utf8");

  const staleCount = staleCountOf(snapshot);
  console.log(
    `\n  wrote ${finalOutPath} (${fmtInt(bytes)} bytes)  generated ${fmtLocal(snapshot.generated)}  ` +
      `divine = ${divineChaos ?? "n/a"} chaos  ${requestsMade} request(s)` +
      (staleCount ? `  ${staleCount} section(s) STALE` : ""),
  );
  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`    - ${w}`);
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`snapshot-prices: unexpected failure: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 1;
  },
);
