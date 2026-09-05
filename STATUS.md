# STATUS — 05/09/2026

Milestones 1 and 2 of `BRIEF.md` §7 are built and checked. Everything is committed on branch `m1-m2-foundation`, pushed, and open as PR #1 against `main` (CI `typecheck-and-test` green). The fix-up requested after the GitHub setup is applied (see "Fix-up" near the end). Waiting for the Craft of Exile numbers.

| Milestone | Result |
|---|---|
| 1. Data build | **PASSED.** `npm run build-data` writes 25 class files (486,488 bytes gzipped) + `index.json`; the Astral Plate ilvl 86 check prints and passes; the build exits 1 if it does not. |
| 2. Roll engine + parity, stage 1 (POC) | **PASSED 10/10.** Every scenario reproduces `poc/results.json` not just within 2× the 95% CI but with bit-identical hit counts (same seed, same draw order). |
| 2. Parity, stage 2 (Craft of Exile) | **PENDING 10/10.** `coe_p` is `null` for every scenario; the test reports them as skipped with "PENDING" in the name. Say "parity numbers" and fill `coe_p` in `test/parity/scenarios.json`. |
| Price snapshot | Written: `public/prices/Allflame.json`, 05/09/2026 10:55, Divine = 452.1c. |
| Solver, parser, UI | Not started, per instructions. `src/ui/App.tsx` is a placeholder heading only. |

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

## VERIFY — every item hit (CLAUDE.md rule 2)

Numbers in brackets are BRIEF.md §9 items.

1. **Affix count on a fresh rare: 4/5/6 at 8/3/1** [§9.1] — `src/engine/roll.ts` `AFFIX_COUNT_WEIGHTS`, POC comment kept verbatim. Every parity scenario depends on it.
2. **The forced essence mod counts inside that N** [§9.2] — `roll.ts` `rollRare`, POC comment kept verbatim. The four essence scenarios embed it; `n` is drawn first and forced mods occupy slots inside it.
3. **Essence-only mods get a value-based tier** (1 + number of rollable tiers whose first-stat max beats theirs) — `pool.ts` `buildPool`, POC comment kept. Titan Greaves: Zeal's 32% Movement Speed is T2 (35% T1, 30% T2). Vaal Axe: Zeal's 28–30% Attack Speed is T1. `titan-zeal-life2` and `vaal-axe-zeal-phys2` will confirm or refute this against CoE.
4. **`adds_tags` do not re-weight later draws.** Weights are resolved once at `buildPool` time against the base tags; the item's tag set grows during a roll (Zeal's axe mod adds `has_attack_mod`) but nothing reads it. BRIEF.md §3 says the tags should change later draws. POC-identical; pinned by `test/engine/roll.test.ts` with a `// VERIFY` so it must be revisited deliberately.
5. **Essence-forced regular mods that cannot roll on the base are dropped from the pool**, so `poolModById` throws for them — `pool.ts` `buildPool`. 316 essence × class pairs have weight 0 on every tag set of the class (e.g. Muttering Essence of Sorrow → `Dexterity2` on a Belt), and any base below the forced mod's level (Deafening Essence of Greed on a Body Armour below ilvl 81) hits the same wall. Whether the game applies the mod anyway is unconfirmed. None of the ten scenarios is affected.
6. **RePoE `essences.json` keys essence mods by 22 item classes.** Rune Dagger and Warstaff are not among them, so their files carry no essences and `essenceForBase` rejects every essence on them, although the game reforges them. Likely fix once confirmed on poedb / CoE: map Rune Dagger → Dagger and Warstaff → Staff in the build. Not applied.
7. **Tier ladders keyed on `groups[0]|side` interleave different stats on 31 ladders** (BRIEF.md §8 risk 5, now measurable). Examples: Amulet `GlobalDamageTypeGemLevel|prefix` ranks the +1 fire / cold / lightning / physical / chaos gem-level mods as T1..T5 though each is the only tier of its own stat; Body Armour `BaseLocalDefences|prefix` ranks Deafening Essence of Woe's flat Energy Shield mod T8 because it is compared by max value against flat Armour. Same pattern in `BaseLocalDefencesAndLife`, `WeaponCasterDamagePrefix`, `IncreaseSpecificSocketedGemLevel`, `SpellAddedElementalDamage`, `DamageOverTimeMultiplier`, the belt flask groups. Per CLAUDE.md, proposal before changing anything: key ladders on `group|side|stats[0].id` (one ladder per stat inside a group) after stage-2 parity passes; the essence value rule then compares like with like. Unchanged for now so the POC comparison holds.
8. **Tiers are independent of item level** (fix-up; CLAUDE.md convention). Each (group, side) ladder ranks every mod that can roll on the base's tag set at any level, so the number is the in-game "(Tier: n)" and what Craft of Exile shows; the pool at an ilvl is the subset that can roll. At ilvl 80 Astral Plate's best rollable life mod is the L73 +145–159 one and it stays T3 (the POC's ilvl-relative rule called it T1). No ladder in any class file has a mod above L86 today (the L87–95 mods all have weight 0 everywhere), so no ilvl-86 pool changed and every parity hit count is identical to before. The UI must still show the mod text with the tier (BRIEF.md §8 risk 6).
9. **Influence-gated mods are not in the class files**, so `buildPool`'s `extraTags` is a no-op today (1,513 item prefix/suffix mods with a positive spawn weight are in no file; 1,446 of them are influence-only, the rest are necropolis/deepwater tags no base carries, plus the five top ward tiers whose `spawn_weights` list helmet/gloves/boots at 0 before `ward_armour`, so the Runic bases cannot roll them — worth a Craft of Exile spot check). The POC over raw `mods.json` would honour influence tags. Documented in `types.ts` and `pool.ts`. Fix when influence is in scope (v2): select mods by base tags plus each class's `item_classes.json` `influence_tags`.
10. **`p90Attempts` is −0 when p = 1** (`ceil(log 0.1 / log 0)`), a POC quirk kept for parity. Treat p = 1 downstream.
11. **Base display names are not unique.** The ten Royale-mode copies are left out of `index.json` (fix-up; they stay in the class files). The base id is the marker: eight of them carry `not_for_sale`, Crude Bow's and Driftwood Wand's copies do not, and the Fishing Rod carries the tag without being a copy, so it stays listed. Duplicated names remain: talisman variants, the three Two-Stone Rings, legacy quivers, Two-Toned Boots × 3 with different tags (so different pools), Energy Blade in both One Hand Sword and Two Hand Sword. `findBase` takes the first, same as the POC; none of the scenario bases is affected. The milestone 3 parser must resolve by id, tags or requirements.
12. **Magic items 1/2 mod split, the 8c reroll's exact semantics, annulment vs fractured/crafted mods, recombinators in 3.29 core** [§9.3–9.6] — not reached yet (milestone 4). **Hybrid mods sharing a group with the plain mod** [§9.7]: the data can answer this per base in milestone 4; not examined.

Data facts worth knowing (not VERIFY): three unreleased StormBlade mods have `text: null` in RePoE and weight 0 everywhere (never written); GitHub Pages replicas stamp `mods.json` Last-Modified a couple of seconds apart, so it is provenance, not a change detector; `requirements` is `null` on every released Ring, Amulet, Belt and Quiver base (182) and is copied verbatim; resolved weights can be fractional (12.5, 87.5) because `generation_weights` are percentages.

## Review pass and what it changed

Five independent reviewers (port fidelity, pool equivalence, spec compliance, data completeness, price script) went over the first build, then three more over the fixes, each with throwaway scripts and a mock poe.ninja rather than by reading alone. Applied from the first round: the price script rejects empty bodies and implausibly shrunken sections instead of overwriting good prices; honours `Retry-After` and never retries plain 4xx; self-heals a torn cache file behind a 304; writes atomically; `deploy.yml` reacts to the cron commit; the cron restores the ETag cache and rebases before pushing; `requirements` is copied verbatim (was zero-filled); HiddenItem is skipped; essence-only weights are 0 by construction. Applied from the second round: the plausibility check runs inside the fetch so a rejected body is never cached and applies even when the previous section is stale (`--force` is the escape hatch); the Cache-Control-fresh path heals a torn cache too; the serialiser uses a function replacer (a `$&` in a base name would have corrupted the file); the case-insensitive league match uses `readdir` (Windows `existsSync` is case-insensitive); the cron workflow has a concurrency group so a manual dispatch cannot race the schedule into a merge conflict; three stale numbers in comments were corrected. Every fix was re-verified against the mock. Findings not acted on are in the VERIFY list above (5–11). The cron workflow those notes mention was removed in the fix-up below.

## Fix-up (05/09/2026, after the GitHub setup)

Three requested changes on branch `m1-m2-foundation`, verified with one focused pass per CLAUDE.md rule 8 (no reviewer agents): `npm test` (85 tests, 75 passed, 10 PENDING; parity stage 1 10/10 with hits identical to before), `npm run typecheck`, `npm run build`, the data build's own self-checks, a probe of every ladder for mods above L86, and the local poe.ninja mock for the price-script flags.

1. **Prices are fetched at deploy time, not committed.** `.github/workflows/snapshot-prices.yml` is deleted. `deploy.yml` now triggers on push to `main`, a 6-hourly schedule (`17 */6 * * *`) and manual dispatch, restores the ETag cache, runs `npm run snapshot-prices -- --league Allflame --force` before `npm run build` (with `continue-on-error`, so a poe.ninja hiccup ships the committed prices rather than blocking a deploy), and no longer has the `workflow_run` trigger. Because `--force` now runs on every deploy, its meaning was narrowed to the 30-minute guard and the Cache-Control shortcut; the "section shrank under half" rejection stays on, and a new `--accept-shrink` flag is the deliberate override. Mock-tested: 40% body with `--force` is still rejected and carried over stale; with `--accept-shrink` it is accepted.
2. **Tiers are independent of item level.** `buildPool` ranks each (group, side) ladder over every mod that can roll on the base's tag set at any level and then takes the ilvl subset as the pool, so tier numbers match the in-game "(Tier: n)" and Craft of Exile. Draw order and weights are untouched. No parity hit count changed: no ladder in any class file contains a mod above L86 (the L87–95 mods in RePoE all have weight 0 on every released tag set). The pool test that asserted the old rule now asserts the new one (ilvl 80 Astral Plate: L73 life mod is T3; Zeal's 32% movement speed is T2 on an ilvl 1 Titan Greaves). Data files unchanged apart from `generated`. VERIFY 8 rewritten.
3. **`index.json` drops the Royale copies.** Ten bases whose id contains "Royale" are left out of the index (still in the class files). The `not_for_sale` tag was not used as the criterion: two Royale copies lack it and the Fishing Rod has it, so the Fishing Rod stays listed ("leave everything else as is"). `classes[].bases` still counts the file's bases (1,017); `index.bases` has 1,007. VERIFY 11 rewritten.

## Next

1. **Cameron:** read the ten scenarios off Craft of Exile and fill `coe_p` in `test/parity/scenarios.json` (`coe_setup` describes each). `npm test` then reports stage 2 PASS/FAIL per scenario. If any fail, work through VERIFY 1–4 in that order before anything downstream.
2. **Merge PR #1** once green: `gh pr merge --squash --delete-branch --auto`, then `git switch main && git pull`, then tag `m2-parity`.
3. **Milestone 3 (parser)** after that, as its own prompt. Not started.

## Files

Scaffold: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.github/ruleset-main.json`, `.claude/settings.json`, `.claude/hooks/guard.mjs`, `.claude/hooks/autosave.mjs`, `.gitattributes`, `.gitignore` (+ `.cache/`).
Scripts: `scripts/build-data.ts`, `scripts/snapshot-prices.ts`.
Engine: `src/engine/types.ts`, `src/engine/rng.ts`, `src/engine/pool.ts`, `src/engine/roll.ts`; `src/prices/types.ts`.
Tests: `test/engine/rng.test.ts`, `test/engine/roll.test.ts`, `test/engine/pool.test.ts`, `test/parity/parity.test.ts`, `test/helpers/data.ts`.
Generated, to be committed: `public/data/*.json.gz` + `index.json`, `public/prices/Allflame.json`.
Untouched: `poc/`, `test/parity/scenarios.json`, `BRIEF.md`, `CLAUDE.md`, `HANDOVER.md`.

Commands: `npm run build-data`, `npm run snapshot-prices` (`-- --force` to skip the 30-minute guard, `-- --accept-shrink` to accept a halved section), `npm test` (`PARITY_EXACT=1` for hard exact-hit assertions), `npm run typecheck`, `npm run build`, `npm run dev`.
