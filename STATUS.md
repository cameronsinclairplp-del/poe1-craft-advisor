# STATUS — 05/09/2026

Milestones 1 to 3 of `BRIEF.md` §7 are built and checked. Milestones 1 and 2 were merged to `main` as PR #1 (squash `9976b87`). Milestone 3, the item parser, is on branch `m3-parser` and is this hand-back's pull request. Still waiting for the Craft of Exile numbers (parity stage 2).

| Milestone | Result |
|---|---|
| 1. Data build | **PASSED.** `npm run build-data` writes 25 class files (now 823,082 bytes gzipped, see milestone 3) + `index.json` + `other_mods.json.gz`; the Astral Plate ilvl 86 check prints and passes; the build exits 1 if it does not. A re-run over unchanged data is byte-identical. |
| 2. Roll engine + parity, stage 1 (POC) | **PASSED 10/10.** Every scenario reproduces `poc/results.json` not just within 2× the 95% CI but with bit-identical hit counts (same seed, same draw order). Unchanged by milestone 3 (re-run 05/09/2026, hits identical). |
| 2. Parity, stage 2 (Craft of Exile) | **PENDING 10/10.** `coe_p` is `null` for every scenario; the test reports them as skipped with "PENDING" in the name. Say "parity numbers" and fill `coe_p` in `test/parity/scenarios.json`. |
| 3. Parser | **PASSED with three real findings.** 19 real Ctrl+Alt+C pastes in `test/fixtures/items`: 14 parse to the right base, item level, mods and tiers (31 in-game tiers cross-checked, all equal); 2 are the jewel and flask that must throw `UnsupportedItemClassError` and do; 3 throw on purpose and are the findings (VERIFY 7 on a real item, new VERIFY 13, and patch drift). 22 unit tests cover the error paths and the cases no public paste exists for. |
| Price snapshot | Written: `public/prices/Allflame.json`, 05/09/2026 10:55, Divine = 452.1c. |
| Solver, UI | Not started, per instructions. `src/ui/App.tsx` is a placeholder heading only. |

## Milestone 1 — data build

Command: `npm run build-data` (`-- --offline` uses the cached downloads, `-- --refresh` revalidates them regardless of age). Raw RePoE files are cached in `.cache/repoe/` (gitignored) with ETag / Last-Modified revalidation after 24 h.

Check printed by the build (BRIEF.md §7.1), verbatim:

```
BRIEF.md §7.1 check — Astral Plate ilvl 86 (Body Armour): 109 rollable mods in pool
Life prefixes on this base:
   T1 L86 +(175-189) to maximum Life (w1000)
   T2 L81 +(160-174) to maximum Life (w1000)
   T3 L73 +(145-159) to maximum Life (w1000)
   ...
Fire res suffixes on this base:
   T1 L84 +(46-48)% to Fire Resistance (w1000)
   T2 L72 +(42-45)% to Fire Resistance (w1000)
   ...
CHECK PASSED: Astral Plate ilvl 86 — 109 rollable mods; life T1 175-189 (L86), T2 160-174 (L81); fire res T1 46-48 (L84)
```

What is in `public/data/`:

| Item | Count |
|---|---|
| Class files (`<Item_Class>.json.gz`, format in `src/engine/types.ts`) | 25 |
| Released, domain `item` bases across them | 1,017 in the class files; 1,007 listed in `index.json` (the ten Royale copies are left out) |
| Distinct tag sets (pre-resolved weights + tier ladders each) | 204 |
| Mods per file (in `mods.json` key order; draw order depends on it) | 82–444 |
| Essences per file | 105 (0 for Rune Dagger, Warstaff, FishingRod — see VERIFY 6) |
| Bench options mapped, incl. the two 3.29 rerolls (3 mods for 3c, 1 mod for 8c) | 765 |
| Fossils (the 25 named ones; 420 unnamed internal `fossils.json` entries skipped) | 25 |
| Source | `mods.json` Last-Modified Fri, 04 Sep 2026 22:58 GMT (40,355 mods; 4,369 item-domain prefix/suffix) |

Self-checks in the script, all fatal: gzip round trip; for every base, `buildPool(file, base, 100)` agrees with the file's pre-resolved weights and tier ladders (1,017 bases); the §7.1 check above. An independent reviewer recomputed everything from raw `mods.json` / `base_items.json`: 0 mismatches over 211 tag sets, 6,848 mod records, 2,310 essence records, 4,505 bench records, and 989,829 (base, ilvl, mod) tier entries at eight item levels.

Selection decisions that are ours, not RePoE's (all logged by the build):

- `HiddenItem` (55 "Random One Hand Sword"-style gamble/idol placeholders, `item_classes.json` category `null`) is skipped. Everything else with a released base and a rollable mod gets a file, including FishingRod (1 base) and the 10 Royale variants tagged `not_for_sale`.
- A mod that an essence forces on a class is kept in the file even when it has weight 0 on every tag set of that class (316 essence × class pairs), so `EssenceRecord.mod_id` always resolves. See VERIFY 5 for why the engine still cannot use those.
- Remnant of Corruption (forced mod `null` for every class) is not written.

## Milestone 2 — roll engine and parity

Port: `src/engine/rng.ts` (mulberry32, byte-identical to the POC), `src/engine/pool.ts` (`findBase`, `resolveWeight`, `resolveGenMultiplier`, `buildPool`, `essenceForBase`, `poolModById`), `src/engine/roll.ts` (`pickAffixCount`, `rollRare`, `hasMod`, `meetsTarget`, `describeTarget`, `estimate`). Same rng call order, pool iteration order, weight summation order and comparisons as `poc/engine.mjs`. `src/engine/types.ts` is the data contract shared with the build script. The engine is pure: no `Math.random`, `Date` or I/O.

`npm test` (Vitest): 84 tests, 74 passed, 10 skipped (the PENDING stage-2 tests), 37.9 s. Parity summary printed by the suite on 05/09/2026:

```
id                         |      sims |      ts_p |  ts_hits |     poc_p | poc_hits | |dp|/ci95 | stage1 | exact |     coe_p |  stage2
astral-chaos-life2-fire2   |    200000 |  0.006280 |     1256 |  0.006280 |     1256 |     0.000 |   PASS |   yes |         - | PENDING
astral-alch-life2-fire2    |    200000 |  0.006280 |     1256 |  0.006280 |     1256 |     0.000 |   PASS |   yes |         - | PENDING
astral-greed-life2-fire2   |    200000 |  0.075600 |    15120 |  0.075600 |    15120 |     0.000 |   PASS |   yes |         - | PENDING
astral-anger-life2-fire2   |    200000 |  0.073815 |    14763 |  0.073815 |    14763 |     0.000 |   PASS |   yes |         - | PENDING
astral-chaos-life1         |    200000 |  0.040600 |     8120 |  0.040600 |     8120 |     0.000 |   PASS |   yes |         - | PENDING
titan-chaos-ms2-life2      |    200000 |  0.007125 |     1425 |  0.007125 |     1425 |     0.000 |   PASS |   yes |         - | PENDING
titan-zeal-life2           |    200000 |  0.073820 |    14764 |  0.073820 |    14764 |     0.000 |   PASS |   yes |         - | PENDING
vaal-axe-chaos-phys2       |   2000000 |  0.003308 |     6615 |  0.003308 |     6615 |     0.006 |   PASS |   yes |         - | PENDING
vaal-axe-zeal-phys2        |   2000000 |  0.002951 |     5902 |  0.002951 |     5902 |     0.000 |   PASS |   yes |         - | PENDING
amethyst-chaos-2of3res2    |    200000 |  0.005210 |     1042 |  0.005210 |     1042 |     0.000 |   PASS |   yes |         - | PENDING
stage 1 PASS 10/10; exact hits 10/10; stage 2 PASS 0, PENDING 10, FAIL 0
```

The only non-zero `|dp|/ci95` (0.006) is rounding: `poc/results.json` stores `poc_p` to six decimals while the TS value is the raw 6615 / 2,000,000. The forced-mod descriptions also match the POC for the four essence scenarios. Before the port, `poc/engine.mjs` was re-run against today's RePoE data and reproduced its own `results.json` hit for hit, so exact reproduction was the right bar. Independent reviewers compared the two engines id-by-id over 2,000 rolls on 16 real base/ilvl/essence cases and 5 synthetic pools (identical), and compared 1,577 (base, ilvl) pools across 13 classes (identical).

How the suite treats the two stages:

- Stage 1: `|ts_p − poc_p| ≤ 2 × ci95_abs`, plus same `sims` and same forced-mod list. Exact hit equality is recorded in the table and asserted only with `PARITY_EXACT=1 npm test`, because a RePoE update would legitimately change hits while stage 1 still passes.
- Stage 2: `|ts_p − coe_p| / coe_p ≤ 0.05`; skipped as PENDING while `coe_p` is `null`. Fill the values in `test/parity/scenarios.json` and the assertion switches on by itself. The scenarios file was not modified.
- Every run writes the rows to `.cache/parity-last-run.json` (gitignored).

Tier numbers are independent of item level (see VERIFY 8), so "T1 or T2" here names the same mods Craft of Exile does at any ilvl. If CoE disagrees with the numbers above, BRIEF.md §7.2 names the suspects: the 4/5/6 split, the essence slot rule, essence-mod tiering, group/adds_tags handling. VERIFY 1–4 below are exactly those.

## Price snapshot

`npm run snapshot-prices [-- --league Allflame] [-- --force]` writes `public/prices/Allflame.json` (1.9 MB; one BaseType line per text line so diffs stay readable). Contents on 05/09/2026 10:55: Currency 100 items, Essence 83, Fossil 25, Resonator 4 (chaos per unit from `lines[].primaryValue`, keyed by display name), BaseType 16,610 lines (plain and single-influence; 1,603 double-influence lines dropped), `divine_chaos` 452.1, ISO timestamps per section and for the file. Type: `src/prices/types.ts`.

Etiquette as CLAUDE.md rule 6: documented `/poe1/api/economy/...` endpoints only; User-Agent `poe1-craft-advisor snapshot-prices/0.1 (+https://github.com/cameronsinclairplp-del/poe1-craft-advisor)`; requests sequential with a 250 ms pause; ETags stored in `.cache/ninja/etags.json` and sent as `If-None-Match` (poe.ninja honours its weak ETags: 304s were observed); `Retry-After` honoured up to 60 s on 429/503, plain 4xx never retried; a snapshot under 30 minutes old stops the script before any request unless `--force`. Fail soft: a failed, empty, malformed or implausibly shrunken section (under half the previous section's lines) is carried over from the previous snapshot with `stale: true` and the bad body is never cached, so a persistently bad feed stays stale until it recovers or `--accept-shrink` accepts it; exit 1 only when there is nothing to fall back on. `--force` bypasses only the 30-minute guard and the Cache-Control shortcut, never the body checks. All of this was exercised against a local mock of the API (empty bodies, 4xx/5xx/`Retry-After` matrix, torn cache files, shrunken feeds, `$`-patterns in names, case-mismatched league ids, the two flags), not just read.

No workflow commits prices. `deploy.yml` runs `npm run snapshot-prices -- --league Allflame --force` as a build step on every deploy (push to `main`, the 6-hourly schedule, manual runs), with the ETag cache restored between runs, so the site ships current prices without a bot commit; a failed snapshot step does not block the deploy (`continue-on-error`), the committed file is built instead. `public/prices/Allflame.json` stays in git as the dev/offline fallback and the baseline the script falls back to. Refresh it by hand occasionally (`npm run snapshot-prices`, commit) so the fallback does not drift too far.

## Milestone 3 — parser (05/09/2026, branch `m3-parser`)

`src/parse/itemText.ts` (with `errors.ts`, `text.ts`, `types.ts`) turns a Ctrl+Alt+C paste into an `Item`: base resolved to a RePoE base id via `index.json` and disambiguated by item class, implicit and requirements; `itemClass`; `ilvl`; `rarity`; `influences`; `corrupted`, `mirrored`, `split`, `synthesised`, `vestigial`, `fracturedItem`; `mods[]` with `side`, `name`, `tier` (from "(Tier: n)"), `rank` (from "(Rank: n)"), `text`, `modId`, `kind`, `flags` (crafted, fractured, veiled, unveiled); `implicits`, `enchants`, `eldritchImplicits`, `uniqueMods` kept apart; `maxPrefixes`/`maxSuffixes`/`openPrefixes`/`openSuffixes`; `metamods`; `warnings`. Two stages: `parseItemText(text)` is structure only (no data, so it never throws for an unknown mod), `resolveItem(raw, data)` needs `index.json`, the class file and `other_mods.json.gz`; `parseItem` does both and `detectItemClass(text, index)` says which class file to load. Leading `#` lines are comments, so a fixture's provenance sits in the file itself.

**Resolution.** Each explicit mod is matched by name + side, then by stat-text template (numbers and ranges become `#`), then by the "(min-max)" ranges the game prints, against the lists in this order: the still-veiled placeholders, the class's rollable mods (`PoolFile.mods`, the only list with a tier ladder), bench crafts, unveiled mods that can be unveiled on the base's tags, influence-gated mods (recorded as `kind: "influence"`, `modId: null`, with the influences and candidate ids), then `other_mods.json.gz`. A name that matches nowhere is an `UnknownModError` naming the line and listing same-name near misses; several equal matches are an `AmbiguousModError`; nothing is guessed. For a pool mod with an in-game tier, the engine's level-independent tier (`buildPool` at ilvl 100) must equal it or the parser throws `TierMismatchError` with the whole ladder and, as a diagnostic, the rank the mod would have if ladders were keyed by RePoE `type`. Essence mods and bench crafts print no tier in the game, so they cannot be cross-checked (VERIFY 17). Slots: normal 0/0, magic 1/1, rare 3/3, shifted by the base implicit's `local_maximum_prefixes_allowed_+` / `local_maximum_suffixes_allowed_+` stats when that implicit is on the item (Helical Ring 1/4, Simplex Amulet 1/2, both real fixtures). Metamods come from the resolved crafted mod's `groups[0]`.

**Data additions** (`scripts/build-data.ts`, class files schema 2, additive; engine files untouched, parity hits identical):

| Addition | Where | Size |
|---|---|---|
| `classes[].name`: in-game "Item Class:" display name from `item_classes.json` (Body Armours, Rune Daggers, Staves, ...) | `index.json` | — |
| `implicit_mods`: text + stats of every implicit the class's bases carry (371 across files) | class files | small |
| `crafted_mods`: the crafted mod of every bench option with `add_explicit_mod`, plus its `bench_tier` (4,122 class × mod entries) | class files | ~90 KB gz |
| `unveiled_mods`: domain "unveiled" mods with weight > 0 on a tag set of the class (673) | class files | small |
| `influence_mods`: item-domain mods absent from `mods` whose spawn_weights name a class influence tag (4,290 entries, 667 of them Maven-elevated versions at weight 0), with `influences` derived from the tag suffix; weights left out to keep the files small (v2 adds them back) | class files | ~200 KB gz |
| `veiled_mods`: the 22 veiled placeholders ("Veiled", "of the Veil", the master-named ones) | class files | tiny |
| `other_mods.json.gz`: every equipment-domain prefix/suffix no class file lists: item 886, crafted 874, delve 177, unveiled 115, mercenary 28, ducat_crafted 15 = 2,095 | new file | 79,951 bytes gz |

Class files went from 486,488 to 823,082 bytes gzipped; `index.json` 168,693; `public/data` total 1,071,726 bytes. The tag suffix → influence mapping (basilisk = Hunter, eyrie = Redeemer, adjudicator = Warlord) is verified on every build against the names the tagged mods carry (`influence names:` line; the build warns if a tag ever carries other names).

**Stamp.** `generated` is now the newest `Last-Modified` among the eight RePoE inputs (2026-09-04T22:58:29.000Z today), not the run time; `source.data_last_modified` keeps the raw header. Checked by building twice with `--offline`: all 27 data files byte-identical (sha1). Caveat already on record: GitHub Pages replicas can stamp `mods.json` a couple of seconds apart, so a re-download from another replica can still move the stamp.

**Fixtures** (`test/fixtures/items/*.txt`, 19 files, each with `# source:` (the public post), `# posted:`, `# note:` and, where the parser must throw, `# expect-error: <ErrorClass>`; drop a new file in and the suite picks it up, with `# source: own stash, DD/MM/YYYY` for Cameron's own items). All are exact Ctrl+Alt+C pastes from GitHub issues of Path of Building, awakened-poe-trade, poe.re, Sidekick and Exiled-Exchange-2; only trailing spaces and runs of blank lines were trimmed. Coverage: rare with a bench craft (Rank shown), rare with a fractured mod and a bench craft on a 1-prefix/4-suffix base, corrupted rare with a Vaal implicit, corrupted rare on a 3.29 "Vestigial" base with hybrid defence mods, rare with the "Cannot roll Attack Modifiers" metamod and a base name shared with a legacy quiver, Shaper + Elder rare (mirrored, split, one unrollable quantity suffix), rare with hybrid flat-armour+life and armour%+stun-recovery prefixes, magic with one prefix (twice, one fractured), magic Two-Stone Ring (three same-name bases, told apart by the implicit), magic with prefix + suffix (twice), normal (twice), corrupted unique, unique with unveiled mods, a rare jewel and a unique flask.

The suite's summary on 05/09/2026:

```
magic-boots-1-prefix                       | magic BootsStrDex10 ilvl 84   | P1/1 S0/1 open 0/1; 1 pool; tiers ok 1
magic-boots-1-prefix-fractured             | magic BootsInt11 ilvl 86      | P1/1 S0/1 open 0/1; 1 pool; tiers ok 1
magic-ring-1-prefix-two-stone              | magic Ring14 ilvl 85          | P1/1 S0/1 open 0/1; 1 pool; tiers ok 1; 1 warning (base chosen by implicit)
magic-sceptre-prefix-suffix                | magic Sceptre22 ilvl 85       | P1/1 S1/1 open 0/0; 2 pool; tiers ok 2
normal-staff-ilvl15                        | normal Staff2 ilvl 15         | no mods
normal-wand                                | normal WandK3 ilvl 84         | no mods
rare-amulet-shaper-elder-mirrored-quantity | rare AmuletE2 ilvl 87         | P1/1 S2/2 open 0/0; 1 influence, 1 pool, 1 other; tiers ok 1; shaper+elder; mirrored
rare-boots-hybrid-defence-mods             | rare BootsStr8 ilvl 86        | P3/3 S3/3 open 0/0; 6 pool; tiers ok 6
rare-gloves-crafted-rank-eldritch          | rare GlovesDexInt8 ilvl 84    | P3/3 S3/3 open 0/0; 4 pool, 1 crafted, 1 other; tiers ok 4; searing-exarch+eater-of-worlds
rare-helmet-corrupted-vestigial-hybrids    | rare HelmetStrDex5 ilvl 85    | P3/3 S3/3 open 0/0; 6 pool; tiers ok 6; corrupted
rare-quiver-crafted-metamod-no-attack      | rare QuiverNew10 ilvl 87      | P3/3 S3/3 open 0/0; 5 pool, 1 crafted; tiers ok 5; no-attack-mods
rare-ring-fractured-crafted-4-suffixes     | rare RingE6 ilvl 84           | P1/1 S4/4 open 0/0; 4 pool, 1 crafted; tiers ok 4
unique-shield-corrupted                    | unique ShieldStrInt11 ilvl 83 | no explicit mods; 6 unique mods; corrupted
unique-warstaff-unveiled-mods              | unique Staff11 ilvl 85        | 3 unresolved (unique); 1 unique mod
magic-staff-prefix-suffix                  | throws TierMismatchError      | VERIFY 7 on a real item, see below
rare-amulet-corrupted-vaal-implicit        | throws TierMismatchError      | VERIFY 13, see below
rare-wand-shaper-elder-crafted             | throws UnknownModError        | patch drift, see below
unsupported-flask-unique                   | throws UnsupportedItemClassError
unsupported-jewel-rare                     | throws UnsupportedItemClassError
```

The three deliberate failures, each kept as a fixture because the parser must keep failing on it until the cause is settled:

1. **VERIFY 7 on a real item.** Imperial Staff, "+4 to Level of all Chaos Spell Skill Gems", in-game Tier 1. The engine's ladder `IncreaseSpecificSocketedGemLevel|prefix` interleaves the fire / cold / lightning / chaos / physical gem-level families and the socketed-melee-gem family (17 entries), so the mod is T4. Ranked by RePoE `type` it is T1, as the game says. The other 31 cross-checked tiers, including the hybrid armour/evasion + stun recovery prefixes on a str/dex helmet and the flat armour + life prefix on Vaal Greaves, agree with the game, so the interleave only bites where several families share a group.
2. **VERIFY 13 (new).** Citrine Amulet, "Thaumaturgist's (Tier: 4)", (18-22)% increased Spell Damage, posted 02/08/2026 (3.29). RePoE (04/09/2026) and Path of Building's `ModExplicit.lua` (regenerated 23/08/2026, with the 3.29 inverted mods) both have exactly five amulet spell damage tiers, which makes this T2. The other three mods on the item check out. Either the game has amulet spell damage tiers neither dataset carries, or the game numbers this family differently.
3. **Patch drift.** Prophecy Wand posted 08/11/2025 (3.26): its "Entombing" prefix shows Adds (41-54) to (81-93) Cold Damage to Spells; the 3.29 data has (52-69) to (103-118) for that mod and nothing with the old ranges. An item copied under an older patch fails with the near misses listed, which is the right outcome.

"Prefixes Cannot Be Changed": no public paste in the advanced format exists on GitHub (issue and code search, all repositories) or the web, so the real metamod fixture is the quiver's "Cannot roll Attack Modifiers", and the prefix lock, suffix lock and multimod are unit-tested in exactly that format (`{ Master Crafted Suffix Modifier "of Prefixes" }` / `Prefixes Cannot Be Changed — Unscalable Value`) on a real gloves paste with a slot freed. The still-veiled format (`{ Prefix Modifier "Veiled" }` over the line `Veiled Prefix`) comes from Path of Building's own parser test data (`spec/System/TestItemParse_spec.lua`), also unit-tested only (VERIFY 19).

Format facts learned from the pastes, all honoured: crafted and fractured are marked in the header by current clients (`Master Crafted`, `Fractured`) and by a line trailer (`(crafted)`, `(fractured)`, `(implicit)`) by older ones; essence mods, bench crafts and a few special mods print no tier; `(Rank: n)` appears on some bench crafts; a magnitude implicit adds `— 70% Increased` to every header; `— Unscalable Value` is appended to fixed-value lines; reminder lines are whole lines in parentheses; enchants have no header; eldritch implicits carry `(Lesser)`-style words; footers can follow the last mod without a separator; 3.26-era clients put a blank line between mods.

**Numbers.** `npm test`: 128 tests, 118 passed, 10 PENDING (parity stage 2), 51 s; parity stage 1 10/10 with hits identical to milestone 2. `npm run typecheck` clean (both configs). `npm run build` clean. `npm run build-data -- --offline` twice: byte-identical.

**Verification effort** (CLAUDE.md rule 8, "the parser: one focused check"): no reviewer agents and no workflows. Before writing the parser, every candidate paste's mod names were pre-checked against the class files and raw `mods.json` with a throwaway script, which is what sorted the 2026 pastes from the stale ones; after, the full test suite, typecheck, build and the double data build. The two data questions the fixtures raised were checked against Path of Building's generated mod data rather than left to reasoning.

## VERIFY — every item hit (CLAUDE.md rule 2)

Numbers in brackets are BRIEF.md §9 items.

1. **Affix count on a fresh rare: 4/5/6 at 8/3/1** [§9.1] — `src/engine/roll.ts` `AFFIX_COUNT_WEIGHTS`, POC comment kept verbatim. Every parity scenario depends on it.
2. **The forced essence mod counts inside that N** [§9.2] — `roll.ts` `rollRare`, POC comment kept verbatim. The four essence scenarios embed it; `n` is drawn first and forced mods occupy slots inside it.
3. **Essence-only mods get a value-based tier** (1 + number of rollable tiers whose first-stat max beats theirs) — `pool.ts` `buildPool`, POC comment kept. Titan Greaves: Zeal's 32% Movement Speed is T2 (35% T1, 30% T2). Vaal Axe: Zeal's 28–30% Attack Speed is T1. `titan-zeal-life2` and `vaal-axe-zeal-phys2` will confirm or refute this against CoE.
4. **`adds_tags` do not re-weight later draws.** Weights are resolved once at `buildPool` time against the base tags; the item's tag set grows during a roll (Zeal's axe mod adds `has_attack_mod`) but nothing reads it. BRIEF.md §3 says the tags should change later draws. POC-identical; pinned by `test/engine/roll.test.ts` with a `// VERIFY` so it must be revisited deliberately.
5. **Essence-forced regular mods that cannot roll on the base are dropped from the pool**, so `poolModById` throws for them — `pool.ts` `buildPool`. 316 essence × class pairs have weight 0 on every tag set of the class (e.g. Muttering Essence of Sorrow → `Dexterity2` on a Belt), and any base below the forced mod's level (Deafening Essence of Greed on a Body Armour below ilvl 81) hits the same wall. Whether the game applies the mod anyway is unconfirmed. None of the ten scenarios is affected.
6. **RePoE `essences.json` keys essence mods by 22 item classes.** Rune Dagger and Warstaff are not among them, so their files carry no essences and `essenceForBase` rejects every essence on them, although the game reforges them. Likely fix once confirmed on poedb / CoE: map Rune Dagger → Dagger and Warstaff → Staff in the build. Not applied.
7. **Tier ladders keyed on `groups[0]|side` interleave different stats on 31 ladders** (BRIEF.md §8 risk 5, now measurable). Examples: Amulet `GlobalDamageTypeGemLevel|prefix` ranks the +1 fire / cold / lightning / physical / chaos gem-level mods as T1..T5 though each is the only tier of its own stat; Body Armour `BaseLocalDefences|prefix` ranks Deafening Essence of Woe's flat Energy Shield mod T8 because it is compared by max value against flat Armour. Same pattern in `BaseLocalDefencesAndLife`, `WeaponCasterDamagePrefix`, `IncreaseSpecificSocketedGemLevel`, `SpellAddedElementalDamage`, `DamageOverTimeMultiplier`, the belt flask groups. **Confirmed on a real item in milestone 3:** the game shows "+4 to Level of all Chaos Spell Skill Gems" on an Imperial Staff as Tier 1; the `IncreaseSpecificSocketedGemLevel|prefix` ladder makes it T4; ranked by RePoE `type` it is T1 (fixture `magic-staff-prefix-suffix`, kept as an expected `TierMismatchError`). Per CLAUDE.md, proposal before changing anything: key ladders on `type|side` (or `group|side|stats[0].id`; the two agree on every case seen) after stage-2 parity passes; the essence value rule then compares like with like. Unchanged for now so the POC comparison holds.
8. **Tiers are independent of item level** (fix-up; CLAUDE.md convention). Each (group, side) ladder ranks every mod that can roll on the base's tag set at any level, so the number is the in-game "(Tier: n)" and what Craft of Exile shows; the pool at an ilvl is the subset that can roll. At ilvl 80 Astral Plate's best rollable life mod is the L73 +145–159 one and it stays T3 (the POC's ilvl-relative rule called it T1). No ladder in any class file has a mod above L86 today (the L87–95 mods all have weight 0 everywhere), so no ilvl-86 pool changed and every parity hit count is identical to before. The UI must still show the mod text with the tier (BRIEF.md §8 risk 6).
9. **Influence-gated mods are not in the pools**, so `buildPool`'s `extraTags` is a no-op today (1,513 item prefix/suffix mods with a positive spawn weight are in no pool; 1,446 of them are influence-only, the rest are necropolis/deepwater tags no base carries, plus the five top ward tiers whose `spawn_weights` list helmet/gloves/boots at 0 before `ward_armour`, so the Runic bases cannot roll them — worth a Craft of Exile spot check). Since milestone 3 each class file lists its influence mods (`influence_mods`, without weights) so the parser can name them; it records them as `kind: "influence"` with `modId: null`, never resolves or tiers them. The POC over raw `mods.json` would honour influence tags. Fix when influence is in scope (v2): select mods by base tags plus each class's `item_classes.json` `influence_tags`, and add the weights back to `influence_mods`.
10. **`p90Attempts` is −0 when p = 1** (`ceil(log 0.1 / log 0)`), a POC quirk kept for parity. Treat p = 1 downstream.
11. **Base display names are not unique.** The ten Royale-mode copies are left out of `index.json` (fix-up; they stay in the class files). The base id is the marker: eight of them carry `not_for_sale`, Crude Bow's and Driftwood Wand's copies do not, and the Fishing Rod carries the tag without being a copy, so it stays listed. Duplicated names remain: talisman variants, the three Two-Stone Rings, legacy quivers, Two-Toned Boots × 3 with different tags (so different pools), Energy Blade in both One Hand Sword and Two Hand Sword. `findBase` takes the first, same as the POC; none of the scenario bases is affected. **The parser resolves by item class, then implicit text, then attribute requirements** (real fixtures: a Two-Stone Ring and a Broadhead Arrow Quiver both resolved by implicit). When a corruption has replaced the implicit and the requirements do not differ (rings, amulets, quivers) it throws `AmbiguousBaseError` naming the candidates; the milestone 6 UI should offer the choice.
12. **Magic items 1/2 mod split, the 8c reroll's exact semantics, annulment vs fractured/crafted mods, recombinators in 3.29 core** [§9.3–9.6] — not reached yet (milestone 4). **Hybrid mods sharing a group with the plain mod** [§9.7]: the data can answer this per base in milestone 4; not examined.
13. **Amulet spell damage shows more tiers in the game than in the data.** A 3.29 paste shows "Thaumaturgist's" (18-22)% increased Spell Damage as "(Tier: 4)"; RePoE and Path of Building both carry five amulet spell damage tiers (Chanter's L5 to Wizard's (23-26) L76), which makes it T2 under the rule that matches every other tier seen (31 of them). Either the game has two higher amulet tiers neither dataset exports, or its tier for this family counts something else. Check on Craft of Exile or in game: how many "increased Spell Damage" prefix tiers does an amulet show? Fixture `rare-amulet-corrupted-vaal-implicit`, kept as an expected `TierMismatchError`.
14. **"(Rank: n)" on a bench craft appears to be the bench option's `bench_tier`.** One data point: Murder Mitts' "(Rank: 3)" Evasion/Energy Shield craft is `bench_tier` 3. The parser records the rank and only warns when it differs.
15. **Unveiled mods print "(Tier: n)" but have no ladder.** Cane of Kulemak shows three "(Tier: 1)" unveiled mods. The parser resolves them by name, side, text and ranges (`unveiled_mods`, filtered by the base's tags) and records the tier without checking it. If milestone 4 needs their tier, the same required_level ranking within `type` and side is the candidate rule; not applied.
16. **"Vestigial <base>" (3.29).** Two real pastes name the base "Vestigial Secutor Helm" / "Vestigial Crusader Plate" with a `{ Vestigial Implicit Modifier }`. The parser strips the word to find the base and sets `vestigial: true`; what the mechanic does to crafting is not modelled and the base's normal pool is assumed.
17. **Essence mods print no tier**, so the parser cannot confirm the value-based essence tier of VERIFY 3; Craft of Exile stage 2 stays the only check.
18. **Known-but-unrollable mods resolve instead of failing.** Real items carry mods no v1 action can roll: a 3.26 mercenary-domain glove suffix, an item-quantity amulet suffix with no spawn weight anywhere, Incursion, Delve and Aspect mods. Rather than refuse such an item, the parser resolves them by exact name, side, text and ranges against `other_mods.json.gz` and marks them `kind: "other"` with the domain and a warning; they occupy their slot. A name that matches nothing is still an `UnknownModError`. If a hard error is preferred here, it is one branch in `ModResolver.resolve`.
19. **Still-veiled mods** are handled in the format Path of Building's parser tests use (`{ Prefix Modifier "Veiled" }` / `Veiled Prefix`, and `"of the Veil"` / `Veiled Suffix`); no real paste with one was found, so it is unit-tested only.

Data facts worth knowing (not VERIFY): three unreleased StormBlade mods have `text: null` in RePoE and weight 0 everywhere (never written); GitHub Pages replicas stamp `mods.json` Last-Modified a couple of seconds apart, so it is provenance, not a change detector; `requirements` is `null` on every released Ring, Amulet, Belt and Quiver base (182) and is copied verbatim; resolved weights can be fractional (12.5, 87.5) because `generation_weights` are percentages.

## Review pass and what it changed

Five independent reviewers (port fidelity, pool equivalence, spec compliance, data completeness, price script) went over the first build, then three more over the fixes, each with throwaway scripts and a mock poe.ninja rather than by reading alone. Applied from the first round: the price script rejects empty bodies and implausibly shrunken sections instead of overwriting good prices; honours `Retry-After` and never retries plain 4xx; self-heals a torn cache file behind a 304; writes atomically; `deploy.yml` reacts to the cron commit; the cron restores the ETag cache and rebases before pushing; `requirements` is copied verbatim (was zero-filled); HiddenItem is skipped; essence-only weights are 0 by construction. Applied from the second round: the plausibility check runs inside the fetch so a rejected body is never cached and applies even when the previous section is stale (`--force` is the escape hatch); the Cache-Control-fresh path heals a torn cache too; the serialiser uses a function replacer (a `$&` in a base name would have corrupted the file); the case-insensitive league match uses `readdir` (Windows `existsSync` is case-insensitive); the cron workflow has a concurrency group so a manual dispatch cannot race the schedule into a merge conflict; three stale numbers in comments were corrected. Every fix was re-verified against the mock. Findings not acted on are in the VERIFY list above (5–11). The cron workflow those notes mention was removed in the fix-up below.

## Fix-up (05/09/2026, after the GitHub setup)

Three requested changes on branch `m1-m2-foundation`, verified with one focused pass per CLAUDE.md rule 8 (no reviewer agents): `npm test` (85 tests, 75 passed, 10 PENDING; parity stage 1 10/10 with hits identical to before), `npm run typecheck`, `npm run build`, the data build's own self-checks, a probe of every ladder for mods above L86, and the local poe.ninja mock for the price-script flags.

1. **Prices are fetched at deploy time, not committed.** `.github/workflows/snapshot-prices.yml` is deleted. `deploy.yml` now triggers on push to `main`, a 6-hourly schedule (`17 */6 * * *`) and manual dispatch, restores the ETag cache, runs `npm run snapshot-prices -- --league Allflame --force` before `npm run build` (with `continue-on-error`, so a poe.ninja hiccup ships the committed prices rather than blocking a deploy), and no longer has the `workflow_run` trigger. Because `--force` now runs on every deploy, its meaning was narrowed to the 30-minute guard and the Cache-Control shortcut; the "section shrank under half" rejection stays on, and a new `--accept-shrink` flag is the deliberate override. Mock-tested: 40% body with `--force` is still rejected and carried over stale; with `--accept-shrink` it is accepted.
2. **Tiers are independent of item level.** `buildPool` ranks each (group, side) ladder over every mod that can roll on the base's tag set at any level and then takes the ilvl subset as the pool, so tier numbers match the in-game "(Tier: n)" and Craft of Exile. Draw order and weights are untouched. No parity hit count changed: no ladder in any class file contains a mod above L86 (the L87–95 mods in RePoE all have weight 0 on every released tag set). The pool test that asserted the old rule now asserts the new one (ilvl 80 Astral Plate: L73 life mod is T3; Zeal's 32% movement speed is T2 on an ilvl 1 Titan Greaves). Data files unchanged apart from `generated`. VERIFY 8 rewritten.
3. **`index.json` drops the Royale copies.** Ten bases whose id contains "Royale" are left out of the index (still in the class files). The `not_for_sale` tag was not used as the criterion: two Royale copies lack it and the Fishing Rod has it, so the Fishing Rod stays listed ("leave everything else as is"). `classes[].bases` still counts the file's bases (1,017); `index.bases` has 1,007. VERIFY 11 rewritten.

## Next

1. **Cameron:** merge the milestone 3 PR once CI is green, then tag it without switching: `git fetch origin && git tag -a m3-parser origin/main -m "Parser: 19 real pastes" && git push origin --tags`.
2. **Cameron:** read the ten scenarios off Craft of Exile and fill `coe_p` in `test/parity/scenarios.json` (`coe_setup` describes each; HANDOVER.md Step B). `npm test` then reports stage 2 PASS/FAIL per scenario. If any fail, work through VERIFY 1–4 in that order before anything downstream. While there, VERIFY 13 is a one-minute check: how many spell damage prefix tiers does Craft of Exile show for an amulet?
3. **Cameron's three items:** save each Ctrl+Alt+C paste as `test/fixtures/items/<name>.txt` with a first line `# source: own stash, DD/MM/YYYY` (and `# note:` if useful); `npm test` parses them and prints the summary row. A `TierMismatchError` or `UnknownModError` on one of them is a finding, not a fixture problem: paste the message.
4. **Milestone 4 + 5** (actions, abstract state, solver) as the next prompt from Cowork, ultracode on. The parser gives it `Item.mods[].modId`, `kind`, `flags`, `metamods`, `open*` and `influences`; `kind: "influence" | "other"` mods occupy a slot and cannot be rolled by v1 actions. The VERIFY 7 ladder change (key on `type|side`) is the first thing to decide once stage 2 parity passes, since milestone 4's tier targets inherit the ladder.

## Files

Scaffold: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.github/ruleset-main.json`, `.claude/settings.json`, `.claude/hooks/guard.mjs`, `.claude/hooks/autosave.mjs`, `.gitattributes`, `.gitignore` (+ `.cache/`).
Scripts: `scripts/build-data.ts`, `scripts/snapshot-prices.ts`.
Engine: `src/engine/types.ts`, `src/engine/rng.ts`, `src/engine/pool.ts`, `src/engine/roll.ts`; `src/prices/types.ts`.
Parser (milestone 3): `src/parse/itemText.ts`, `src/parse/errors.ts`, `src/parse/text.ts`, `src/parse/types.ts`.
Tests: `test/engine/rng.test.ts`, `test/engine/roll.test.ts`, `test/engine/pool.test.ts`, `test/parity/parity.test.ts`, `test/parse/fixtures.test.ts`, `test/parse/itemText.test.ts`, `test/helpers/data.ts`; fixtures `test/fixtures/items/*.txt` (19).
Generated, committed: `public/data/*.json.gz` (25 class files + `other_mods.json.gz`) + `index.json`, `public/prices/Allflame.json`.
Untouched: `poc/`, `test/parity/scenarios.json`, `BRIEF.md`, `CLAUDE.md`. `HANDOVER.md` carries Cameron's Step A–D walkthrough (committed on `m3-parser` as found in the working tree).

Commands: `npm run build-data`, `npm run snapshot-prices` (`-- --force` to skip the 30-minute guard, `-- --accept-shrink` to accept a halved section), `npm test` (`PARITY_EXACT=1` for hard exact-hit assertions), `npm run typecheck`, `npm run build`, `npm run dev`.
