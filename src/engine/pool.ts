// Mod pool for a base at an item level. Port of poc/engine.mjs §2 over the PoolFile format.
// Filters, ordering and weights are identical to the POC, so draws are identical. Tier numbering
// differs on purpose: tiers are independent of item level here (see buildPool).

import type { BaseRecord, PoolFile, PoolInfo, PoolMod, TagWeight } from "./types.ts";

/** Find a released base of this class by display name. Throws if absent. */
export function findBase(file: PoolFile, name: string): BaseRecord {
  const hit = file.bases.find((b) => b.name === name);
  if (!hit) throw new Error(`base not found in ${file.item_class} data: ${name}`);
  return hit;
}

/** RePoE spawn_weights are ORDERED: the first entry whose tag the item carries wins. */
export function resolveWeight(list: readonly TagWeight[], tags: ReadonlySet<string>): number {
  for (const { tag, weight } of list) if (tags.has(tag)) return weight;
  return 0;
}

/** generation_weights are percentage multipliers, same first-match rule. */
export function resolveGenMultiplier(list: readonly TagWeight[], tags: ReadonlySet<string>): number {
  for (const { tag, weight } of list) if (tags.has(tag)) return weight / 100;
  return 1;
}

/**
 * Build the pool of explicit prefixes/suffixes that can roll on `base` at `ilvl`, plus the
 * essence-only mods that essences can force onto it. `extraTags` lets you add influence tags
 * (e.g. "body_armour_shaper") later. Note that the class files do not yet carry influence-gated
 * mods (see PoolFile.mods), so today extraTags changes nothing; the POC over raw mods.json would
 * honour them. Fix in build-data before influence is attempted.
 *
 * Tiers are independent of item level (CLAUDE.md conventions). Each (group, side) ladder ranks
 * every mod that can roll on the base's tag set at any level, best (highest required_level) first,
 * so the number is the in-game "(Tier: n)" and what Craft of Exile shows. The pool at `ilvl` is
 * the subset whose required_level fits; a mod keeps its ladder tier whatever the item level, so at
 * ilvl 80 an Astral Plate's best rollable life mod is T3, not T1. poc/engine.mjs ranked over the
 * ilvl-filtered pool instead; the two agree wherever no ladder has a mod above the item level.
 */
export function buildPool(file: PoolFile, base: BaseRecord, ilvl: number, extraTags: readonly string[] = []): PoolInfo {
  const tags = new Set<string>([...base.tags, ...extraTags]);
  // Every mod that can roll on these tags at any level, plus the essence-only mods. In mods order.
  const ladderMods: PoolMod[] = [];
  file.mods.forEach((m, index) => {
    const w = resolveWeight(m.spawn_weights, tags) * resolveGenMultiplier(m.generation_weights, tags);
    // Rollable mods need weight (and, below, level). Essence-only mods are forced, so neither
    // applies to them. A regular mod that an essence forces but that has weight 0 on this base or
    // required_level above ilvl (e.g. Muttering Essence of Sorrow -> Dexterity2 on a Belt;
    // Deafening Essence of Greed on a Body Armour below ilvl 81) is therefore not in the pool, so
    // poolModById throws for it. Same as the POC. Whether the game applies the essence mod
    // anyway is unconfirmed.                                                             // VERIFY
    if (!m.is_essence_only && w <= 0) return;
    ladderMods.push({
      id: m.id,
      name: m.name,
      text: m.text.split("\n")[0] ?? m.text,
      side: m.side,
      group: m.groups[0] ?? m.type,
      type: m.type,
      level: m.required_level,
      weight: m.is_essence_only ? 0 : w,
      statMax: m.stats[0]?.max ?? null,
      essenceOnly: m.is_essence_only,
      addsTags: m.adds_tags,
      tier: null,
      index,
    });
  });
  // Tier = rank by required_level, best first, within (group, side), over rollable mods only.
  // Essence-only mods get a value-based tier: 1 + number of rollable tiers with a higher
  // first-stat max. So an essence mod that beats T1 is T1; one between T1 and T2 is T2.   // VERIFY
  const byKey = new Map<string, { regular: PoolMod[]; essence: PoolMod[] }>();
  for (const p of ladderMods) {
    const k = `${p.group}|${p.side}`;
    let bucket = byKey.get(k);
    if (!bucket) byKey.set(k, (bucket = { regular: [], essence: [] }));
    bucket[p.essenceOnly ? "essence" : "regular"].push(p);
  }
  for (const { regular, essence } of byKey.values()) {
    regular.sort((a, b) => b.level - a.level); // stable: equal levels keep mods order
    regular.forEach((p, i) => (p.tier = i + 1));
    for (const e of essence) {
      const max = e.statMax;
      e.tier = max == null ? null : 1 + regular.filter((r) => r.statMax != null && r.statMax > max).length;
    }
  }
  // The pool at this item level: rollable mods whose required_level fits, and every essence-only
  // mod (forced mods ignore the level requirement, as in the POC). Order is preserved.
  const pool = ladderMods.filter((p) => p.essenceOnly || p.level <= ilvl);
  return { base, ilvl, tags, pool };
}

/** The mod id an essence forces on this base's item class. Throws if the essence cannot be used on it. */
export function essenceForBase(file: PoolFile, essenceName: string, base: BaseRecord): string {
  const e = file.essences.find((x) => x.name === essenceName);
  if (!e) throw new Error(`${essenceName} cannot be used on ${base.item_class} (not in ${file.item_class} data)`);
  return e.mod_id;
}

/** Find a pool mod by RePoE id. Throws if it is not in the pool (POC: "forced mod ... not in pool"). */
export function poolModById(poolInfo: PoolInfo, id: string): PoolMod {
  const m = poolInfo.pool.find((p) => p.id === id);
  if (!m) throw new Error(`forced mod ${id} not in pool`);
  return m;
}
