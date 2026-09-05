// poe1-craft-advisor — proof of concept (Node 18+, zero dependencies)
//
// Proves the whole pipeline end to end for PoE 1 (3.29 / Allflame):
//   RePoE-fork game data  ->  per-base mod pool with tiers  ->  weighted roll engine
//   ->  Monte Carlo odds for a target  ->  live poe.ninja prices  ->  cost per method
//
// Run:   node engine.mjs                                   # demo: Astral Plate, 3 methods
//        node engine.mjs --scenarios ../test/parity/scenarios.json --out results.json
//        node engine.mjs --base "Astral Plate" --ilvl 86 --league Allflame --sims 200000
//
// Everything here is deliberately small and readable so it can be ported to TypeScript
// for the web app. Assumptions that still need verifying are marked  // VERIFY.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 0. CLI + constants
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] ?? "true"]);
    return acc;
  }, []),
);
const HERE = dirname(fileURLToPath(import.meta.url));
const LEAGUE = args.league ?? "Allflame";
const BASE_NAME = args.base ?? "Astral Plate";
const ILVL = Number(args.ilvl ?? 86);
const SIMS = Number(args.sims ?? 200_000);
const UA = "poe1-craft-advisor-poc/0.1 (github.com/cameronsinclairplp-del)";

const REPOE = "https://repoe-fork.github.io"; // PoE1 files live at the root
const NINJA = "https://poe.ninja/poe1/api/economy";

// How many affixes a freshly rolled rare gets. Weights 8:3:1 for 4/5/6 is the
// community-accepted datamined split (jewels differ).            // VERIFY against CoE
const AFFIX_COUNT_WEIGHTS = { 4: 8, 5: 3, 6: 1 };

// ---------------------------------------------------------------------------
// 1. Data loading (cached to ./cache so re-runs are instant)
// ---------------------------------------------------------------------------
async function fetchJson(url, cacheName, maxAgeMs = 6 * 3600_000) {
  const dir = resolve(HERE, "cache");
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, cacheName);
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < maxAgeMs) {
    return JSON.parse(await readFile(path, "utf8"));
  }
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  await writeFile(path, text);
  return JSON.parse(text);
}

const [MODS, BASES, ESSENCES] = await Promise.all([
  fetchJson(`${REPOE}/mods.json`, "mods.json", 7 * 24 * 3600_000),
  fetchJson(`${REPOE}/base_items.json`, "base_items.json", 7 * 24 * 3600_000),
  fetchJson(`${REPOE}/essences.json`, "essences.json", 7 * 24 * 3600_000),
]);

// ---------------------------------------------------------------------------
// 2. Mod pool for a base at an item level
// ---------------------------------------------------------------------------
function findBase(name) {
  const hit = Object.entries(BASES).find(
    ([, b]) => b.name === name && b.release_state === "released" && b.domain === "item",
  );
  if (!hit) throw new Error(`base not found: ${name}`);
  return { id: hit[0], ...hit[1] };
}

// RePoE spawn_weights are ORDERED: the first entry whose tag the item carries wins.
function resolveWeight(list, tags) {
  for (const { tag, weight } of list) if (tags.has(tag)) return weight;
  return 0;
}
// generation_weights are percentage multipliers, same first-match rule.
function resolveGenMultiplier(list, tags) {
  for (const { tag, weight } of list) if (tags.has(tag)) return weight / 100;
  return 1;
}

/**
 * Build the pool of explicit prefixes/suffixes that can roll on `base` at `ilvl`,
 * plus the essence-only mods that essences can force onto it.
 * `extraTags` lets you add influence tags (e.g. "body_armour_shaper") later.
 */
function buildPool(base, ilvl, extraTags = []) {
  const tags = new Set([...base.tags, ...extraTags]);
  const pool = [];
  for (const [id, m] of Object.entries(MODS)) {
    if (m.domain !== "item") continue;
    if (m.generation_type !== "prefix" && m.generation_type !== "suffix") continue;
    // Royale-only mods (MovementVelocity2Royale, IncreasedCastSpeed2Royale, ...) carry ordinary
    // spawn weights in RePoE but never roll outside the Royale event; Craft of Exile leaves them
    // out. Same exclusion as scripts/build-data.ts. Edit to poc/ authorised by Cameron, 05/09/2026.
    if (id.includes("Royale")) continue;
    const w = resolveWeight(m.spawn_weights, tags) * resolveGenMultiplier(m.generation_weights, tags);
    // Rollable mods need level + weight. Essence-only mods are forced, so neither applies to them.
    if (!m.is_essence_only && (m.required_level > ilvl || w <= 0)) continue;
    pool.push({
      id,
      name: m.name,
      text: m.text.split("\n")[0],
      side: m.generation_type,
      group: m.groups[0] ?? m.type,
      type: m.type,
      level: m.required_level,
      weight: m.is_essence_only ? 0 : w,
      statMax: m.stats[0]?.max ?? null,
      essenceOnly: m.is_essence_only,
      addsTags: m.adds_tags ?? [],
    });
  }
  // Tier = rank by required_level, best first, within (group, side), over rollable mods only.
  // Essence-only mods get a value-based tier: 1 + number of rollable tiers with a higher
  // first-stat max. So an essence mod that beats T1 is T1; one between T1 and T2 is T2.   // VERIFY
  const byKey = new Map();
  for (const p of pool) {
    const k = `${p.group}|${p.side}`;
    if (!byKey.has(k)) byKey.set(k, { regular: [], essence: [] });
    byKey.get(k)[p.essenceOnly ? "essence" : "regular"].push(p);
  }
  for (const { regular, essence } of byKey.values()) {
    regular.sort((a, b) => b.level - a.level);
    regular.forEach((p, i) => (p.tier = i + 1));
    for (const e of essence) {
      e.tier = e.statMax == null ? null : 1 + regular.filter((r) => r.statMax != null && r.statMax > e.statMax).length;
    }
  }
  return { base, ilvl, tags, pool };
}

// ---------------------------------------------------------------------------
// 3. Roll engine — one draw at a time, weighted, no repeated group, max 3 per side
// ---------------------------------------------------------------------------
function pickAffixCount(rng) {
  const entries = Object.entries(AFFIX_COUNT_WEIGHTS);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [n, w] of entries) if ((r -= w) < 0) return Number(n);
  return 4;
}

/**
 * Roll a rare from scratch (chaos / alch / essence). `forced` mods are placed first,
 * then the remaining slots are filled by weighted draws from what is still eligible.
 * Returns the list of mods on the item.
 */
function rollRare(poolInfo, rng, forced = []) {
  const { pool } = poolInfo;
  const n = pickAffixCount(rng); // VERIFY: forced essence mod counts inside n (assumed here)
  const item = [];
  const usedGroups = new Set();
  const tags = new Set(poolInfo.tags);
  let prefixes = 0, suffixes = 0;

  const place = (m) => {
    item.push(m);
    usedGroups.add(m.group);
    if (m.side === "prefix") prefixes++; else suffixes++;
    for (const t of m.addsTags) tags.add(t);
  };
  for (const m of forced) place(m);

  while (item.length < n) {
    // eligible = rollable, right side not full, group not used
    let total = 0;
    const elig = [];
    for (const m of pool) {
      if (m.essenceOnly) continue;
      if (usedGroups.has(m.group)) continue;
      if (m.side === "prefix" && prefixes >= 3) continue;
      if (m.side === "suffix" && suffixes >= 3) continue;
      elig.push(m);
      total += m.weight;
    }
    if (!elig.length) break;
    let r = rng() * total;
    for (const m of elig) {
      if ((r -= m.weight) < 0) { place(m); break; }
    }
  }
  return item;
}

/**
 * Target = list of picks. A pick is either
 *   { group, side?, minTier }                                  — this mod at this tier or better
 *   { kOf: 2, options: [{ group, side?, minTier }, ...] }      — any k of these
 * Every pick must be satisfied.
 */
const hasMod = (item, t) =>
  item.some((m) => m.group === t.group && (!t.side || m.side === t.side) && m.tier != null && m.tier <= t.minTier);
function meetsTarget(item, target) {
  return target.every((t) =>
    t.kOf != null ? t.options.filter((o) => hasMod(item, o)).length >= t.kOf : hasMod(item, t),
  );
}

// Deterministic PRNG (mulberry32) so runs are reproducible.
function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 4. Prices — poe.ninja documented economy endpoints (chaos-denominated)
// ---------------------------------------------------------------------------
async function loadPrices(league) {
  const ex = async (type) =>
    fetchJson(`${NINJA}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`, `ninja_${league}_${type}.json`, 30 * 60_000);
  const [currency, essence] = await Promise.all([ex("Currency"), ex("Essence")]);
  const priceById = new Map();
  for (const d of [currency, essence]) for (const l of d.lines) priceById.set(l.id, l.primaryValue);
  const idByName = new Map();
  for (const d of [currency, essence]) for (const it of d.items ?? []) idByName.set(it.name, it.id);

  const bases = await fetchJson(
    `${NINJA}/stash/current/item/overview?league=${encodeURIComponent(league)}&type=BaseType`,
    `ninja_${league}_BaseType.json`, 30 * 60_000,
  );
  return {
    chaos: (name) => {
      const id = idByName.get(name);
      const v = id ? priceById.get(id) : undefined;
      if (v == null) throw new Error(`no price for ${name}`);
      return v;
    },
    divine: priceById.get("divine"),
    basePrice: (name, ilvl, variant) => {
      const hit = bases.lines.find(
        (l) => l.name === name && l.levelRequired === ilvl && (variant ? l.variant === variant : !l.variant),
      );
      return hit?.chaosValue ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Methods — each is "reroll from scratch, maybe with a forced mod"
// ---------------------------------------------------------------------------
function essenceForBase(essenceName, base) {
  const e = Object.values(ESSENCES).find((x) => x.name === essenceName);
  if (!e) throw new Error(`essence not found: ${essenceName}`);
  const modId = e.mods[base.item_class];
  if (!modId) throw new Error(`${essenceName} cannot be used on ${base.item_class}`);
  return modId;
}

/** method = { kind: "chaos" | "alch" | "essence", essence?: "Deafening Essence of Greed" } */
function methodSpec(method, base, prices) {
  switch (method.kind) {
    case "chaos": return { label: "Chaos Orb spam", forcedIds: [], costPerAttempt: prices.chaos("Chaos Orb") };
    case "alch": return { label: "Alch + scour spam", forcedIds: [], costPerAttempt: prices.chaos("Orb of Alchemy") + prices.chaos("Orb of Scouring") };
    case "essence": return {
      label: `${method.essence} spam`,
      forcedIds: [essenceForBase(method.essence, base)],
      costPerAttempt: prices.chaos(method.essence),
    };
    default: throw new Error(`unknown method kind ${method.kind}`);
  }
}

function estimate({ label, poolInfo, target, forcedIds = [], costPerAttempt, sims, seed = 7 }) {
  const rng = makeRng(seed);
  const forced = forcedIds.map((id) => {
    const m = poolInfo.pool.find((p) => p.id === id);
    if (!m) throw new Error(`forced mod ${id} not in pool`);
    return m;
  });
  let hits = 0;
  for (let i = 0; i < sims; i++) if (meetsTarget(rollRare(poolInfo, rng, forced), target)) hits++;
  const p = hits / sims;
  const ci95 = 1.96 * Math.sqrt((p * (1 - p)) / sims); // normal approx, absolute
  const expAttempts = p > 0 ? 1 / p : Infinity;
  const p90Attempts = p > 0 ? Math.ceil(Math.log(0.1) / Math.log(1 - p)) : Infinity; // geometric
  return { label, p, hits, sims, ci95, expAttempts, p90Attempts, costPerAttempt, expCost: expAttempts * costPerAttempt, p90Cost: p90Attempts * costPerAttempt, forced: forced.map((m) => `${m.text} (T${m.tier})`) };
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("en-AU", { maximumFractionDigits: 1 }) : "∞");
const describeTarget = (target) =>
  target.map((t) => (t.kOf != null ? `${t.kOf} of {${t.options.map((o) => `${o.group}≥T${o.minTier}`).join(", ")}}` : `${t.group} ≥ T${t.minTier}`)).join(" AND ");

// ---------------------------------------------------------------------------
// 6a. Scenario mode — run the parity scenarios file and record our numbers
// ---------------------------------------------------------------------------
if (args.scenarios) {
  const file = resolve(process.cwd(), args.scenarios);
  const spec = JSON.parse(await readFile(file, "utf8"));
  const prices = await loadPrices(spec.league ?? LEAGUE);
  const pools = new Map();
  const results = [];
  console.log(`\n${spec.scenarios.length} scenarios — ${spec.league ?? LEAGUE} — Divine = ${prices.divine} chaos — default ${SIMS} rolls, low-p scenarios set their own\n`);
  console.log("id".padEnd(30), "p/attempt".padStart(10), "±95%".padStart(8), "hits".padStart(7), "E[attempts]".padStart(12), "E[cost] c".padStart(10), "  target");
  for (const sc of spec.scenarios) {
    const key = `${sc.base}|${sc.ilvl}`;
    if (!pools.has(key)) pools.set(key, buildPool(findBase(sc.base), sc.ilvl));
    const poolInfo = pools.get(key);
    const ms = methodSpec(sc.method, poolInfo.base, prices);
    const r = estimate({ ...ms, poolInfo, target: sc.target, sims: sc.sims ?? SIMS });
    results.push({ id: sc.id, poc_p: Number(r.p.toFixed(6)), ci95_abs: Number(r.ci95.toFixed(6)), hits: r.hits, sims: r.sims, exp_attempts: Number(r.expAttempts.toFixed(1)), cost_per_attempt_c: Number(r.costPerAttempt.toFixed(3)), exp_cost_c: Number(r.expCost.toFixed(1)), forced: r.forced });
    console.log(sc.id.padEnd(30), (r.p * 100).toFixed(3).padStart(9) + "%", ("±" + (r.ci95 * 100).toFixed(3)).padStart(8), String(r.hits).padStart(7), fmt(r.expAttempts).padStart(12), fmt(r.expCost).padStart(10), "  " + describeTarget(sc.target) + (r.forced.length ? `  [forced: ${r.forced.join(", ")}]` : ""));
  }
  const out = resolve(process.cwd(), args.out ?? "results.json");
  await writeFile(out, JSON.stringify({ generated: new Date().toISOString(), league: spec.league ?? LEAGUE, sims: SIMS, divine_chaos: prices.divine, results }, null, 2));
  console.log(`\nwrote ${out}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 6b. Demo scenario
// ---------------------------------------------------------------------------
const base = findBase(BASE_NAME);
const poolInfo = buildPool(base, ILVL);
const prices = await loadPrices(LEAGUE);

const target = [
  { group: "IncreasedLife", side: "prefix", minTier: 2 },   // +160 life or better
  { group: "FireResistance", side: "suffix", minTier: 2 },  // +42% fire res or better
];

const fmtDiv = (c) => (Number.isFinite(c) ? (c / prices.divine).toFixed(2) : "∞");

console.log(`\n${BASE_NAME} ilvl ${ILVL} — ${LEAGUE} — ${poolInfo.pool.filter((p) => !p.essenceOnly).length} rollable mods in pool`);
console.log(`Divine = ${prices.divine} chaos. Fresh base ≈ ${prices.basePrice(BASE_NAME, ILVL) ?? "n/a"} chaos (poe.ninja BaseType).`);
console.log(`Target: ${describeTarget(target)}\n`);

const results = [
  { kind: "chaos" },
  { kind: "essence", essence: "Deafening Essence of Greed" },
  { kind: "essence", essence: "Deafening Essence of Anger" },
].map((m) => estimate({ ...methodSpec(m, base, prices), poolInfo, target, sims: SIMS }));

console.log("method".padEnd(34), "p/attempt".padStart(10), "E[attempts]".padStart(12), "cost/att".padStart(9), "E[cost] c".padStart(10), "E[cost] div".padStart(12), "p90 cost c".padStart(11));
for (const r of results.sort((a, b) => a.expCost - b.expCost)) {
  console.log(
    r.label.padEnd(34),
    (r.p * 100).toFixed(2).padStart(9) + "%",
    fmt(r.expAttempts).padStart(12),
    r.costPerAttempt.toFixed(2).padStart(9),
    fmt(r.expCost).padStart(10),
    fmtDiv(r.expCost).padStart(12),
    fmt(r.p90Cost).padStart(11),
  );
}
console.log(`\nCheapest on expectation: ${results[0].label}`);

// A peek at the tiering so the numbers can be sanity-checked against poedb / Craft of Exile
const show = (g, side) =>
  poolInfo.pool.filter((p) => p.group === g && p.side === side).sort((a, b) => a.tier - b.tier)
    .map((p) => `T${p.tier} L${p.level} ${p.text}${p.essenceOnly ? " (essence-only)" : ` (w${p.weight})`}`).join("\n   ");
console.log(`\nLife prefixes on this base:\n   ${show("IncreasedLife", "prefix")}`);
console.log(`\nFire res suffixes on this base:\n   ${show("FireResistance", "suffix")}`);
