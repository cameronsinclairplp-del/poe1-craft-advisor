# STATUS — 05/09/2026 (evening)

Milestones 1 to 3 of `BRIEF.md` §7 are built, checked and merged to `main` (PR #1 squash `9976b87`, PR #2 squash `d46ac9c`). This hand-back, branch `parity-tiers`, closes parity stage 2 against Craft of Exile, re-keys the tier ladders per RePoE type, turns the parser's tier cross-check into a warning, and adds Cameron's three 3.29 items as fixtures. One data bug found on the way: four Royale-only mods were in the pools.

| Milestone | Result |
|---|---|
| 1. Data build | **PASSED.** `npm run build-data` writes 25 class files (828,266 bytes gzipped) + `index.json` + `other_mods.json.gz`; the Astral Plate ilvl 86 check prints and passes; the build exits 1 if it does not. Two `--offline` runs are byte-identical (sha1 over all 27 files). New this hand-back: the four Royale-only mods are excluded, ladders are keyed (group, side, type). |
| 2. Roll engine + parity, stage 1 (POC) | **PASSED 10/10, hits bit-identical** to `poc/results.json`, regenerated today with the same Royale exclusion (same seed; the ten hit counts are exactly the ones Cameron predicted). |
| 2. Parity, stage 2 (Craft of Exile) | **PASSED 10/10.** Every scenario within 5% relative of CoE's Calculator; the six chaos/alch scenarios within 1.5%, the four essence scenarios within 3.3% (see the essence note, VERIFY 20). Table below. |
| 3. Parser | **PASSED, 22 fixtures.** 19 public pastes + Cameron's three items. 19 parse to the right base, item level, mods and tiers (47 in-game tiers cross-checked: 46 equal, 1 declared mismatch = VERIFY 13; two of the 19 are uniques, rarity only); 2 throw `UnsupportedItemClassError` (jewel, flask); 1 throws `UnknownModError` (3.26 patch drift). Every warning any fixture raises is declared in the fixture and asserted. |
| Price snapshot | Unchanged: `public/prices/Allflame.json`, 05/09/2026 10:55, Divine = 452.1c. |
| Solver, UI | Not started, per instructions. `src/ui/App.tsx` is a placeholder heading only. |

`npm test`: 141 tests, 141 passed, 0 skipped, 56 s. `npm run typecheck` clean (both configs). `npm run build` clean.

## Parity stage 2 — Craft of Exile (05/09/2026)

`coe_p` is filled for all ten scenarios in `test/parity/scenarios.json` (values read by Cowork off craftofexile.com's Calculator, 3.29 data, 05/09/2026; the amethyst value is derived by inclusion-exclusion and titan-zeal was also run through CoE's Simulator; the `_readme` in the file says exactly how). Nothing else in the scenarios changed. The suite's table on 05/09/2026:

```
id                         |      sims |      ts_p |  ts_hits |     poc_p | poc_hits | |dp|/ci95 | stage1 | exact |     coe_p |  stage2
astral-chaos-life2-fire2   |    200000 |  0.006280 |     1256 |  0.006280 |     1256 |     0.000 |   PASS |   yes |  0.006310 |    PASS
astral-alch-life2-fire2    |    200000 |  0.006280 |     1256 |  0.006280 |     1256 |     0.000 |   PASS |   yes |  0.006310 |    PASS
astral-greed-life2-fire2   |    200000 |  0.075600 |    15120 |  0.075600 |    15120 |     0.000 |   PASS |   yes |  0.075750 |    PASS
astral-anger-life2-fire2   |    200000 |  0.073815 |    14763 |  0.073815 |    14763 |     0.000 |   PASS |   yes |  0.075130 |    PASS
astral-chaos-life1         |    200000 |  0.040600 |     8120 |  0.040600 |     8120 |     0.000 |   PASS |   yes |  0.040020 |    PASS
titan-chaos-ms2-life2      |    200000 |  0.007590 |     1518 |  0.007590 |     1518 |     0.000 |   PASS |   yes |  0.007630 |    PASS
titan-zeal-life2           |    200000 |  0.073820 |    14764 |  0.073820 |    14764 |     0.000 |   PASS |   yes |  0.071870 |    PASS
vaal-axe-chaos-phys2       |   2000000 |  0.003302 |     6603 |  0.003302 |     6603 |     0.006 |   PASS |   yes |  0.003290 |    PASS
vaal-axe-zeal-phys2        |   2000000 |  0.002951 |     5902 |  0.002951 |     5902 |     0.000 |   PASS |   yes |  0.003050 |    PASS
amethyst-chaos-2of3res2    |    200000 |  0.005210 |     1042 |  0.005210 |     1042 |     0.000 |   PASS |   yes |  0.005210 |    PASS
stage 1 PASS 10/10; exact hits 10/10; stage 2 PASS 10, PENDING 0, FAIL 0
```

Deviation from CoE, (ts_p − coe_p) / coe_p, with our own 95% CI in relative terms for scale:

| Scenario | Method | Deviation | Our ±95% CI |
|---|---|---|---|
| astral-chaos-life2-fire2 | chaos | −0.48% | ±5.5% |
| astral-alch-life2-fire2 | alch | −0.48% | ±5.5% |
| astral-chaos-life1 | chaos | +1.45% | ±2.1% |
| titan-chaos-ms2-life2 | chaos | −0.52% | ±5.0% |
| vaal-axe-chaos-phys2 | chaos | +0.35% | ±2.4% |
| amethyst-chaos-2of3res2 | chaos | 0.00% | ±6.1% |
| astral-greed-life2-fire2 | essence, forced prefix, target suffix | −0.20% | ±1.5% |
| astral-anger-life2-fire2 | essence, forced suffix, target prefix | −1.75% | ±1.5% |
| titan-zeal-life2 | essence, forced prefix, target prefix | +2.71% | ±1.6% |
| vaal-axe-zeal-phys2 | essence, forced suffix, target prefix | −3.25% | ±2.5% |

Every chaos/alch scenario is inside its own Monte Carlo noise of CoE's number. Three of the four essence scenarios are not, and the sign follows the sides: the one scenario whose forced mod shares the target's side is above CoE's Calculator, the three whose forced mod is on the other side are below. CoE's Calculator is an approximation for essences; its Simulator is the emulation, and for titan-zeal-life2 the Simulator gives 7.321% ± 0.093 (300,000 essences) against our 7.382%, inside its noise. Recorded as VERIFY 20; the 5% bar passes either way.

**The Royale finding.** Four item-domain prefix/suffix mods with ordinary spawn weights in RePoE only roll in the Royale event and are excluded by CoE: `MovementVelocity2Royale` (boots, "Sprinter's" 15–25% movement speed, w1000), `IncreasedCastSpeed2Royale` (wand/sceptre/amulet/shield/gloves), `LocalIncreasedAttackSpeed2Royale____` (every weapon, w1000) and `IncreasedAttackSpeed2Royale` (gloves/quiver/shields). They inflated Titan Greaves' prefix total to 40,000 and Vaal Axe's suffix total to 62,750 and sat in the ladders (the boots one at T6 of movement speed, pushing the 10% mod to T7). `scripts/build-data.ts` now leaves every id containing "Royale" out of every file (class files and `other_mods`), `poc/engine.mjs` got the same one-line exclusion (authorised edit), and the pool weight totals at ilvl 86 equal CoE's on all four parity bases, pinned as tests in `test/engine/pool.test.ts`:

| Base | Prefix total | Suffix total |
|---|---|---|
| Astral Plate | 45,500 | 58,200 |
| Titan Greaves | 39,000 (was 40,000) | 56,600 |
| Vaal Axe | 49,614 | 61,750 (was 62,750) |
| Amethyst Ring | 60,250 | 103,600 |

Regenerating `poc/results.json` with the exclusion moved two hit counts (titan-chaos 1425 → 1518, vaal-chaos 6615 → 6603) and left the other eight untouched; the TS engine reproduces all ten bit for bit. The other ~140 mods with "Royale" in the id are unique/chest/monster mods that never qualified for a file; the ten Royale base copies stay in the class files as before (VERIFY 11).

## Tier ladders per (group, side, type) — VERIFY 7 closed

The ladder key gained the RePoE `type` (`scripts/build-data.ts` `tierKey`, `src/engine/pool.ts` `buildPool`, `TagSetRecord.tiers` keys are now `"group|side|type"`; CLAUDE.md Conventions updated). Still level-independent, still over every mod that can roll on the base's tag set. Evidence, all from Cameron's items and the public pastes, tiers as the game prints them:

| Item | Mod | Old (group, side) tier | Per-type tier | Game |
|---|---|---|---|---|
| Imperial Staff | "Stone Singer's" +4 Physical Spell Skill Gems (`GlobalPhysicalSpellGemsLevelTwoHand3`) | T5 | **T1** | 1 |
| Imperial Staff | "Tecton's" +3 (`GlobalPhysicalSpellGemsLevelTwoHand2_`) | T11 | **T2** | (RePoE ladder) |
| Imperial Staff | "Lithomancer's" +2 (`GlobalPhysicalSpellGemsLevelTwoHand1_`) | T17 | **T3** | (RePoE ladder) |
| Imperial Staff (magic fixture) | "Schismatist's" +4 Chaos Spell Skill Gems | T4 | **T1** | 1 |
| Twilight Regalia | "Priest's" +ES / +mana hybrid (`LocalBaseEnergyShieldAndMana3`) | T4 (shared `BaseLocalDefencesAndLife`) | **T2** | 2 |

Measured over the whole data (`.cache`-free scratch script, old files from git against the new build, engine to engine): 30 (group, side) keys across 13 class files held more than one type (188 tag-set ladders); of 220,086 (base, rollable mod) pairs, 13,844 tiers moved, every one explained: 12,643 by a multi-type ladder splitting, 1,201 by a Royale mod leaving a ladder, 0 unexplained. No parity tier moved (the ten scenarios touch single-type groups only; `npm test` proves it, hits identical). 2,855 of the moved tiers are essence-only value tiers: the value rule now compares like with like, so Deafening Essence of Woe's flat Energy Shield on a pure-armour chest is T1 (nothing of its type on the base) instead of a rank against flat Armour; 3,629 (base × essence mod) cases had no same-type rollable sibling at all. `build-data`'s self-check (buildPool at ilvl 100 agrees with the stored ladders for 1,017 bases) and the test-side re-check (now five class files, plus "every ladder holds one type") both pass.

A consequence for milestone 4 to keep in mind: a target pick is still `{ group, side, minTier }`, and a multi-type group now has several T1s (fire / cold / lightning / chaos / physical gem level are each T1 on a staff). Targets on such groups should name the type as well; the pick shape can grow a `type` when the solver needs it.

## Parser: tier cross-check is a warning; Cameron's three items

**Tier mismatch never throws.** `TierMismatchError` is gone from `src/parse/errors.ts`. A pool mod whose in-game "(Tier: n)" differs from the engine's ladder resolves as before (name + side + text + ranges pick the mod, the number is informational) and gets `tierCheck: "mismatch"` plus a warning naming both numbers and the whole (group, side, type) ladder. `src/parse/types.ts` documents the new `TierCheck` value.

**other_mods disambiguation.** When several `other_mods` entries match name, side, text and ranges equally (177 (name, side, text) keys are shared today, mostly Incursion's level-50 twins, 5 of them Delve), the ones with a positive spawn weight on one of the base's tags are preferred; still several after that is `AmbiguousModError`, never a guess. Cameron's Delve suffix needed no disambiguation (one entry matched), but the branch is there and documented in `ModResolver.resolve`.

**Fixture warnings are declared.** New directive `# expect-warning: <text>` (one per warning, substring match, the line number the warning ends with left out); the suite asserts the count and the texts, so a new paste that warns fails with the warning quoted. The six public fixtures that already warned now declare it; the VERIFY 13 amulet went from `# expect-error: TierMismatchError` to one `# expect-warning:`; the magic staff fixture lost its `# expect-error:` and parses clean.

**Cameron's items** (`# source: own stash, 05/09/2026`; the staff had a chat sentence and two blank lines pasted into its Requirements block, removed, nothing else touched; the trailing space the game prints after the socket string is stripped, as in every other fixture):

1. `rare-staff-crafted-rank-gem-level.txt` — Imperial Staff "Woe Bane", ilvl 87. All five explicit mods are pool mods at the tier the game prints (Stone Singer's `GlobalPhysicalSpellGemsLevelTwoHand3` T1 per type; Archon's `GlobalSpellGemsLevelTwoHand2` T1; Runic `SpellDamageOnTwoHandWeapon8` T1; of Destruction `LocalCriticalMultiplier6` T1; of Finesse `IncreasedCastSpeedTwoHand7` T1). "of Craft" (Rank: 2) is `EinharMasterCriticalStrikeChanceSpells2h2_`, whose bench option is bench_tier 2 (VERIFY 14, second data point, no warning). Two enchants kept as enchants. **0 warnings.**
2. `rare-body-armour-fractured-delve-eldritch-heist-enchant.txt` — Twilight Regalia "Apocalypse Coat", ilvl 88, Searing Exarch (Exquisite) + Eater of Worlds (Grand) implicits, Fractured Item. "Unfaltering" `LocalIncreasedEnergyShieldPercent8` T1, "Priest's" `LocalBaseEnergyShieldAndMana3` T2 (per type; T4 before), "Resplendent" `LocalIncreasedEnergyShield11` T1; the enchant "8% increased Explicit Defence Modifier magnitudes" kept as an enchant and its "— 8% Increased" header note treated as display-only (same shape as the Simplex Amulet); "of the Order" is the unveiled `JunMasterVeiledColdAndChaosDamageResistance` printed with a tier (VERIFY 15, recorded not checked); "of Craft" is the crafted hybrid `JunMaster2StrengthAndIntelligence3`, no Rank printed; the fractured "of the Underground" is `DelveDexterityGemLevel1`, kind "other", domain delve, fractured flag set. **1 warning**, quoted: `suffix "of the Underground" is DelveDexterityGemLevel1 (delve domain): on the item, occupies its slot, but no v1 action can roll it (line 37)`. Data fact corrected on the way: in RePoE this mod has positive spawn weights on 17 tags (staff 750, int_armour 750, bow 1600, …), not 0; it is in no class file because its domain is `delve`, not `item`, and those weights only apply through fossils.
3. `magic-body-armour-prefix-suffix.txt` — "Vigorous Titan Plate of Thick Skin", ilvl 85: "Vigorous" `IncreasedLife10` T3, "of Thick Skin" `StunRecovery1` T6, both as the game says, values print as 149(145-159). **0 warnings.**

Nothing on the three items failed to resolve.

The suite's summary on 05/09/2026 (22 fixtures):

```
magic-body-armour-prefix-suffix                         | magic BodyStr18 ilvl 85            | P1/1 S1/1 open 0/0; 2 pool; tiers ok 2
magic-boots-1-prefix                                    | magic BootsStrDex10 ilvl 84        | P1/1 S0/1 open 0/1; 1 pool; tiers ok 1
magic-boots-1-prefix-fractured                          | magic BootsInt11 ilvl 86           | P1/1 S0/1 open 0/1; 1 pool; tiers ok 1
magic-ring-1-prefix-two-stone                           | magic Ring14 ilvl 85               | P1/1 S0/1 open 0/1; 1 pool; tiers ok 1; 1 warning
magic-sceptre-prefix-suffix                             | magic Sceptre22 ilvl 85            | P1/1 S1/1 open 0/0; 2 pool; tiers ok 2
magic-staff-prefix-suffix                               | magic Staff18 ilvl 85              | P1/1 S1/1 open 0/0; 2 pool; tiers ok 2
normal-staff-ilvl15                                     | normal Staff2 ilvl 15              | P0/0 S0/0 open 0/0; no mods; tiers ok 0
normal-wand                                             | normal WandK3 ilvl 84              | P0/0 S0/0 open 0/0; no mods; tiers ok 0
rare-amulet-corrupted-vaal-implicit                     | rare Amulet10 ilvl 80              | P2/3 S2/3 open 1/1; 4 pool; tiers ok 3, MISMATCH 1; corrupted; 1 warning
rare-amulet-shaper-elder-mirrored-quantity              | rare AmuletE2 ilvl 87              | P1/1 S2/2 open 0/0; 1 influence, 1 pool, 1 other; tiers ok 1; shaper+elder; mirrored; 1 warning
rare-body-armour-fractured-delve-eldritch-heist-enchant | rare BodyInt20 ilvl 88             | P3/3 S3/3 open 0/0; 3 pool, 1 other, 1 unveiled, 1 crafted; tiers ok 3; searing-exarch+eater-of-worlds; 1 warning
rare-boots-hybrid-defence-mods                          | rare BootsStr8 ilvl 86             | P3/3 S3/3 open 0/0; 6 pool; tiers ok 6
rare-gloves-crafted-rank-eldritch                       | rare GlovesDexInt8 ilvl 84         | P3/3 S3/3 open 0/0; 4 pool, 1 crafted, 1 other; tiers ok 4; searing-exarch+eater-of-worlds; 1 warning
rare-helmet-corrupted-vestigial-hybrids                 | rare HelmetStrDex5 ilvl 85         | P3/3 S3/3 open 0/0; 6 pool; tiers ok 6; corrupted
rare-quiver-crafted-metamod-no-attack                   | rare QuiverNew10 ilvl 87           | P3/3 S3/3 open 0/0; 5 pool, 1 crafted; tiers ok 5; no-attack-mods; 1 warning
rare-ring-fractured-crafted-4-suffixes                  | rare RingE6 ilvl 84                | P1/1 S4/4 open 0/0; 4 pool, 1 crafted; tiers ok 4
rare-staff-crafted-rank-gem-level                       | rare Staff18 ilvl 87               | P3/3 S3/3 open 0/0; 5 pool, 1 crafted; tiers ok 5
rare-wand-shaper-elder-crafted                          | throws UnknownModError             | patch drift (3.26 paste), unchanged
unique-shield-corrupted                                 | unique ShieldStrInt11 ilvl 83      | P0/0 S0/0 open 0/0; no mods; tiers ok 0; corrupted; 2 warnings
unique-warstaff-unveiled-mods                           | unique Staff11 ilvl 85             | P2/0 S1/0 open 0/0; 3 unique; tiers ok 0; 1 warning
unsupported-flask-unique                                | throws UnsupportedItemClassError
unsupported-jewel-rare                                  | throws UnsupportedItemClassError
```

Every warning any fixture raises, verbatim (line numbers count the `#` lines):

- magic-ring-1-prefix-two-stone: `base name "Two-Stone Ring" is shared by several bases; chose Metadata/Items/Rings/Ring14 by implicit`
- rare-quiver-crafted-metamod-no-attack: `base name "Broadhead Arrow Quiver" is shared by several bases; chose Metadata/Items/Quivers/QuiverNew10 by implicit`
- rare-amulet-shaper-elder-mirrored-quantity: `suffix "of Amassment" is ItemFoundQuantityIncrease4 (item domain): on the item, occupies its slot, but no v1 action can roll it (line 29)`
- rare-gloves-crafted-rank-eldritch: `suffix "of Infamy" is MercenaryModTrapMineChain (mercenary domain): on the item, occupies its slot, but no v1 action can roll it (line 36)`
- rare-body-armour-fractured-delve-eldritch-heist-enchant: `suffix "of the Underground" is DelveDexterityGemLevel1 (delve domain): on the item, occupies its slot, but no v1 action can roll it (line 37)`
- rare-amulet-corrupted-vaal-implicit (VERIFY 13): `prefix "Thaumaturgist's" (SpellDamage4): the game says Tier 4, the engine's ladder SpellDamage|prefix|SpellDamage says T2; resolved by name, side and text, the number is informational. Ladder: T1 L76 SpellDamage5 "(23-26)% increased Spell Damage"; T2 L56 SpellDamage4 "(18-22)% increased Spell Damage"; T3 L38 SpellDamage3 "(13-17)% increased Spell Damage"; T4 L20 SpellDamage2 "(8-12)% increased Spell Damage"; T5 L5 SpellDamage1 "(3-7)% increased Spell Damage" (line 21)`
- unique-shield-corrupted (flavour text): `unrecognised line 41: "Born from the marriage of ice and sky,"` and `unrecognised line 42: "the aurora evokes both awe and power."`
- unique-warstaff-unveiled-mods (flavour text): `unrecognised line 39: "Stolen power is still power."`

**Verification effort** (CLAUDE.md rule 8; HANDOVER Step B said no workflows): no reviewer agents and no workflows. Checks that ran: `npm test` (141 tests; parity stage 1 exact on all ten, stage 2 10/10); the POC regenerated with the same seed and its hit counts compared with the ten Cameron predicted (all equal); `npm run build-data -- --offline` twice with sha1 over all 27 files (identical) and its own consistency self-check over 1,017 bases; the before/after tier diff over 220,086 (base, mod) pairs described above; the CoE weight totals on the four parity bases as tests; every fixture parsed and its warnings read before the expectations were written; `npm run typecheck`; `npm run build`.

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

What is in `public/data/` (05/09/2026 evening build):

| Item | Count |
|---|---|
| Class files (`<Item_Class>.json.gz`, format in `src/engine/types.ts`) | 25, 828,266 bytes gzipped |
| Released, domain `item` bases across them | 1,017 in the class files; 1,007 listed in `index.json` (the ten Royale copies are left out) |
| Distinct tag sets (pre-resolved weights + tier ladders each) | 204 |
| Mods per file (in `mods.json` key order; draw order depends on it) | 81–442 (the four Royale-only mods are excluded) |
| Essences per file | 105 (0 for Rune Dagger, Warstaff, FishingRod — see VERIFY 6) |
| Bench options mapped, incl. the two 3.29 rerolls (3 mods for 3c, 1 mod for 8c) | 765 |
| Fossils (the 25 named ones; 420 unnamed internal `fossils.json` entries skipped) | 25 |
| `other_mods.json.gz` | 2,095 mods, 79,951 bytes gzipped; `index.json` 168,693 bytes; `public/data` total 1,076,910 bytes |
| Source | `mods.json` Last-Modified Fri, 04 Sep 2026 22:58 GMT (40,355 mods; 4,365 item-domain prefix/suffix candidates after the Royale exclusion) |

Self-checks in the script, all fatal: gzip round trip; for every base, `buildPool(file, base, 100)` agrees with the file's pre-resolved weights and tier ladders (1,017 bases); the §7.1 check above. An independent reviewer recomputed everything from raw `mods.json` / `base_items.json` for the first build: 0 mismatches over 211 tag sets, 6,848 mod records, 2,310 essence records, 4,505 bench records, and 989,829 (base, ilvl, mod) tier entries at eight item levels.

Selection decisions that are ours, not RePoE's (all logged by the build):

- `HiddenItem` (55 "Random One Hand Sword"-style gamble/idol placeholders, `item_classes.json` category `null`) is skipped. Everything else with a released base and a rollable mod gets a file, including FishingRod (1 base) and the 10 Royale variants tagged `not_for_sale`.
- A mod that an essence forces on a class is kept in the file even when it has weight 0 on every tag set of that class (316 essence × class pairs), so `EssenceRecord.mod_id` always resolves. See VERIFY 5 for why the engine still cannot use those.
- Remnant of Corruption (forced mod `null` for every class) is not written.
- Every mod whose id contains "Royale" is left out of every file (the four Royale-only prefix/suffix mods; see the parity section). The build logs the ids and warns if the count is ever not four.

## Milestone 2 — roll engine and parity

Port: `src/engine/rng.ts` (mulberry32, byte-identical to the POC), `src/engine/pool.ts` (`findBase`, `resolveWeight`, `resolveGenMultiplier`, `buildPool`, `essenceForBase`, `poolModById`), `src/engine/roll.ts` (`pickAffixCount`, `rollRare`, `hasMod`, `meetsTarget`, `describeTarget`, `estimate`). Same rng call order, pool iteration order, weight summation order and comparisons as `poc/engine.mjs`. `src/engine/types.ts` is the data contract shared with the build script. The engine is pure: no `Math.random`, `Date` or I/O.

How the suite treats the two stages:

- Stage 1: `|ts_p − poc_p| ≤ 2 × ci95_abs`, plus same `sims` and same forced-mod list. Exact hit equality is recorded in the table and asserted only with `PARITY_EXACT=1 npm test`, because a RePoE update would legitimately change hits while stage 1 still passes.
- Stage 2: `|ts_p − coe_p| / coe_p ≤ 0.05`; would be skipped as PENDING if `coe_p` were `null` again.
- Every run writes the rows to `.cache/parity-last-run.json` (gitignored).

Before the port, `poc/engine.mjs` was re-run against today's RePoE data and reproduced its own `results.json` hit for hit, so exact reproduction was the right bar; it still holds after today's regeneration. Independent reviewers compared the two engines id-by-id over 2,000 rolls on 16 real base/ilvl/essence cases and 5 synthetic pools (identical), and compared 1,577 (base, ilvl) pools across 13 classes (identical).

## Price snapshot

`npm run snapshot-prices [-- --league Allflame] [-- --force]` writes `public/prices/Allflame.json` (1.9 MB; one BaseType line per text line so diffs stay readable). Contents on 05/09/2026 10:55: Currency 100 items, Essence 83, Fossil 25, Resonator 4 (chaos per unit from `lines[].primaryValue`, keyed by display name), BaseType 16,610 lines (plain and single-influence; 1,603 double-influence lines dropped), `divine_chaos` 452.1, ISO timestamps per section and for the file. Type: `src/prices/types.ts`.

Etiquette as CLAUDE.md rule 6: documented `/poe1/api/economy/...` endpoints only; User-Agent `poe1-craft-advisor snapshot-prices/0.1 (+https://github.com/cameronsinclairplp-del/poe1-craft-advisor)`; requests sequential with a 250 ms pause; ETags stored in `.cache/ninja/etags.json` and sent as `If-None-Match` (poe.ninja honours its weak ETags: 304s were observed); `Retry-After` honoured up to 60 s on 429/503, plain 4xx never retried; a snapshot under 30 minutes old stops the script before any request unless `--force`. Fail soft: a failed, empty, malformed or implausibly shrunken section (under half the previous section's lines) is carried over from the previous snapshot with `stale: true` and the bad body is never cached, so a persistently bad feed stays stale until it recovers or `--accept-shrink` accepts it; exit 1 only when there is nothing to fall back on. `--force` bypasses only the 30-minute guard and the Cache-Control shortcut, never the body checks. All of this was exercised against a local mock of the API (empty bodies, 4xx/5xx/`Retry-After` matrix, torn cache files, shrunken feeds, `$`-patterns in names, case-mismatched league ids, the two flags), not just read.

No workflow commits prices. `deploy.yml` runs `npm run snapshot-prices -- --league Allflame --force` as a build step on every deploy (push to `main`, the 6-hourly schedule, manual runs), with the ETag cache restored between runs, so the site ships current prices without a bot commit; a failed snapshot step does not block the deploy (`continue-on-error`), the committed file is built instead. `public/prices/Allflame.json` stays in git as the dev/offline fallback and the baseline the script falls back to. Refresh it by hand occasionally (`npm run snapshot-prices`, commit) so the fallback does not drift too far. (The POC's own price fetch during today's regeneration saw Divine = 428.4c; the committed snapshot was not refreshed.)

## Milestone 3 — parser (05/09/2026, PR #2; changes today above)

`src/parse/itemText.ts` (with `errors.ts`, `text.ts`, `types.ts`) turns a Ctrl+Alt+C paste into an `Item`: base resolved to a RePoE base id via `index.json` and disambiguated by item class, implicit and requirements; `itemClass`; `ilvl`; `rarity`; `influences`; `corrupted`, `mirrored`, `split`, `synthesised`, `vestigial`, `fracturedItem`; `mods[]` with `side`, `name`, `tier` (from "(Tier: n)"), `rank` (from "(Rank: n)"), `text`, `modId`, `kind`, `flags` (crafted, fractured, veiled, unveiled), `ourTier`, `tierCheck` (`ok` | `mismatch` | `no-game-tier` | `no-ladder`); `implicits`, `enchants`, `eldritchImplicits`, `uniqueMods` kept apart; `maxPrefixes`/`maxSuffixes`/`openPrefixes`/`openSuffixes`; `metamods`; `warnings`. Two stages: `parseItemText(text)` is structure only (no data, so it never throws for an unknown mod), `resolveItem(raw, data)` needs `index.json`, the class file and `other_mods.json.gz`; `parseItem` does both and `detectItemClass(text, index)` says which class file to load. Leading `#` lines are comments, so a fixture's provenance and expectations sit in the file itself.

**Resolution.** Each explicit mod is matched by name + side, then by stat-text template (numbers and ranges become `#`), then by the "(min-max)" ranges the game prints, against the lists in this order: the still-veiled placeholders, the class's rollable mods (`PoolFile.mods`, the only list with a tier ladder), bench crafts, unveiled mods that can be unveiled on the base's tags, influence-gated mods (recorded as `kind: "influence"`, `modId: null`, with the influences and candidate ids), then `other_mods.json.gz` (several equal matches narrowed by the base's tags). A name that matches nowhere is an `UnknownModError` naming the line and listing same-name near misses; several equal matches are an `AmbiguousModError`; nothing is guessed. For a pool mod with an in-game tier, the engine's level-independent tier (`buildPool` at ilvl 100) is compared with it: equal is `tierCheck: "ok"`, different is `"mismatch"` plus a warning with the whole ladder (never a throw, since 05/09/2026). Essence mods and bench crafts print no tier in the game, so they cannot be cross-checked (VERIFY 17). Slots: normal 0/0, magic 1/1, rare 3/3, shifted by the base implicit's `local_maximum_prefixes_allowed_+` / `local_maximum_suffixes_allowed_+` stats when that implicit is on the item (Helical Ring 1/4, Simplex Amulet 1/2, both real fixtures). Metamods come from the resolved crafted mod's `groups[0]`.

**Data additions** (`scripts/build-data.ts`, class files schema 2, additive):

| Addition | Where | Size |
|---|---|---|
| `classes[].name`: in-game "Item Class:" display name from `item_classes.json` (Body Armours, Rune Daggers, Staves, ...) | `index.json` | — |
| `implicit_mods`: text + stats of every implicit the class's bases carry (371 across files) | class files | small |
| `crafted_mods`: the crafted mod of every bench option with `add_explicit_mod`, plus its `bench_tier` (4,122 class × mod entries) | class files | ~90 KB gz |
| `unveiled_mods`: domain "unveiled" mods with weight > 0 on a tag set of the class (673) | class files | small |
| `influence_mods`: item-domain mods absent from `mods` whose spawn_weights name a class influence tag (4,290 entries, 667 of them Maven-elevated versions at weight 0), with `influences` derived from the tag suffix; weights left out to keep the files small (v2 adds them back) | class files | ~200 KB gz |
| `veiled_mods`: the 22 veiled placeholders ("Veiled", "of the Veil", the master-named ones) | class files | tiny |
| `other_mods.json.gz`: every equipment-domain prefix/suffix no class file lists: item 886, crafted 874, delve 177, unveiled 115, mercenary 28, ducat_crafted 15 = 2,095 | own file | 79,951 bytes gz |

The tag suffix → influence mapping (basilisk = Hunter, eyrie = Redeemer, adjudicator = Warlord) is verified on every build against the names the tagged mods carry (`influence names:` line; the build warns if a tag ever carries other names).

**Stamp.** `generated` is the newest `Last-Modified` among the eight RePoE inputs (2026-09-04T22:58:29.000Z), not the run time; `source.data_last_modified` keeps the raw header. Caveat already on record: GitHub Pages replicas can stamp `mods.json` a couple of seconds apart, so a re-download from another replica can still move the stamp.

**Fixtures** (`test/fixtures/items/*.txt`, 22 files, each with `# source:` (the public post, or `own stash, DD/MM/YYYY`), `# posted:` for public ones, `# note:`, `# expect-error: <ErrorClass>` where the parser must throw, and `# expect-warning: <text>` for every warning it raises; drop a new file in and the suite picks it up). The 19 public ones are exact Ctrl+Alt+C pastes from GitHub issues of Path of Building, awakened-poe-trade, poe.re, Sidekick and Exiled-Exchange-2; only trailing spaces and runs of blank lines were trimmed. Coverage: rare with a bench craft (Rank shown, twice), rare with a fractured mod and a bench craft on a 1-prefix/4-suffix base, corrupted rare with a Vaal implicit, corrupted rare on a 3.29 "Vestigial" base with hybrid defence mods, rare with the "Cannot roll Attack Modifiers" metamod and a base name shared with a legacy quiver, Shaper + Elder rare (mirrored, split, one unrollable quantity suffix), eldritch-influenced rares (twice, one with a Heist enchant, a Delve fractured mod and an unveiled mod), rare with hybrid flat-armour+life and armour%+stun-recovery prefixes, rare staff with three gem-level prefixes and two enchants, magic with one prefix (twice, one fractured), magic Two-Stone Ring (three same-name bases, told apart by the implicit), magic with prefix + suffix (four times), normal (twice), corrupted unique, unique with unveiled mods, a rare jewel and a unique flask.

The one deliberate failure left: **patch drift.** Prophecy Wand posted 08/11/2025 (3.26): its "Entombing" prefix shows Adds (41-54) to (81-93) Cold Damage to Spells; the 3.29 data has (52-69) to (103-118) for that mod and nothing with the old ranges. An item copied under an older patch fails with the near misses listed, which is the right outcome.

"Prefixes Cannot Be Changed": no public paste in the advanced format exists on GitHub (issue and code search, all repositories) or the web, so the real metamod fixture is the quiver's "Cannot roll Attack Modifiers", and the prefix lock, suffix lock and multimod are unit-tested in exactly that format (`{ Master Crafted Suffix Modifier "of Prefixes" }` / `Prefixes Cannot Be Changed — Unscalable Value`) on a real gloves paste with a slot freed. The still-veiled format (`{ Prefix Modifier "Veiled" }` over the line `Veiled Prefix`) comes from Path of Building's own parser test data (`spec/System/TestItemParse_spec.lua`), also unit-tested only (VERIFY 19).

Format facts learned from the pastes, all honoured: crafted and fractured are marked in the header by current clients (`Master Crafted`, `Fractured`) and by a line trailer (`(crafted)`, `(fractured)`, `(implicit)`) by older ones; essence mods, bench crafts and a few special mods print no tier; `(Rank: n)` appears on some bench crafts; a magnitude implicit or a Heist defence enchant adds `— 70% Increased` / `— 8% Increased` to the affected headers; `— Unscalable Value` is appended to fixed-value lines; reminder lines are whole lines in parentheses; enchants have no header; eldritch implicits carry `(Lesser)`-style words up to `(Exquisite)`; footers can follow the last mod without a separator; 3.26-era clients put a blank line between mods; requirements print `(unmet)` after the number.

## VERIFY — every item hit (CLAUDE.md rule 2)

Numbers in brackets are BRIEF.md §9 items.

1. **Affix count on a fresh rare: 4/5/6 at 8/3/1** [§9.1] — `src/engine/roll.ts` `AFFIX_COUNT_WEIGHTS`, POC comment kept verbatim. **Confirmed by parity stage 2 (05/09/2026):** the six chaos/alch scenarios, which depend on nothing else, are within 1.5% of Craft of Exile (and inside our own Monte Carlo noise). Comment in `roll.ts` stays as a record of the source; the item is closed.
2. **The forced essence mod counts inside that N** [§9.2] — `roll.ts` `rollRare`, POC comment kept verbatim. **Confirmed by parity stage 2:** the four essence scenarios pass the 5% bar against CoE's Calculator, and titan-zeal-life2 agrees with CoE's Simulator (the emulation) within its noise (7.382% vs 7.321% ± 0.093). The residual Calculator offsets are VERIFY 20. Closed.
3. **Essence-only mods get a value-based tier** (1 + number of rollable tiers of the same (group, side, type) whose first-stat max beats theirs) — `pool.ts` `buildPool`, POC comment kept, now per type (like with like; 2,855 essence value tiers moved on 05/09/2026, see the ladder section). Titan Greaves: Zeal's 32% Movement Speed is T2 (35% T1, 30% T2). Vaal Axe: Zeal's 28–30% Attack Speed is T1. The parity scenarios do not exercise the number itself (their targets are on other mods), so this stays open; the game prints no tier on essence mods (VERIFY 17).
4. **`adds_tags` do not re-weight later draws.** Weights are resolved once at `buildPool` time against the base tags; the item's tag set grows during a roll (Zeal's axe mod adds `has_attack_mod`) but nothing reads it. BRIEF.md §3 says the tags should change later draws. POC-identical; pinned by `test/engine/roll.test.ts` with a `// VERIFY` so it must be revisited deliberately. Parity stage 2 did not separate this: no scenario's target depends on a tag-gated mod.
5. **Essence-forced regular mods that cannot roll on the base are dropped from the pool**, so `poolModById` throws for them — `pool.ts` `buildPool`. 316 essence × class pairs have weight 0 on every tag set of the class (e.g. Muttering Essence of Sorrow → `Dexterity2` on a Belt), and any base below the forced mod's level (Deafening Essence of Greed on a Body Armour below ilvl 81) hits the same wall. Whether the game applies the mod anyway is unconfirmed. None of the ten scenarios is affected.
6. **RePoE `essences.json` keys essence mods by 22 item classes.** Rune Dagger and Warstaff are not among them, so their files carry no essences and `essenceForBase` rejects every essence on them, although the game reforges them. Likely fix once confirmed on poedb / CoE: map Rune Dagger → Dagger and Warstaff → Staff in the build. Not applied.
7. **Tier ladders keyed on `groups[0]|side` interleaved different stats.** **Closed 05/09/2026** by keying ladders on (group, side, type): "Stone Singer's" +4 Physical Spell Skill Gems on Cameron's Imperial Staff is Tier 1 in the game and was T5 on the shared ladder; per type Stone Singer's 1, Tecton's 2, Lithomancer's 3; the magic staff fixture's "Schismatist's" (+4 Chaos) went from T4 to the game's T1; Twilight Regalia's "Priest's" hybrid from T4 to the game's T2. 30 (group, side) keys across 13 class files were affected; every one of the 13,844 moved tiers is explained (ladder section). The alternative key `group|side|stats[0].id` was not needed; `type` agreed with the game on every case seen.
8. **Tiers are independent of item level** (CLAUDE.md convention). Each (group, side, type) ladder ranks every mod that can roll on the base's tag set at any level, so the number is the in-game "(Tier: n)" and what Craft of Exile shows; the pool at an ilvl is the subset that can roll. At ilvl 80 Astral Plate's best rollable life mod is the L73 +145–159 one and it stays T3. The UI must still show the mod text with the tier (BRIEF.md §8 risk 6).
9. **Influence-gated mods are not in the pools**, so `buildPool`'s `extraTags` is a no-op today (1,513 item prefix/suffix mods with a positive spawn weight are in no pool; 1,446 of them are influence-only, the rest are necropolis/deepwater tags no base carries, plus the five top ward tiers whose `spawn_weights` list helmet/gloves/boots at 0 before `ward_armour`, so the Runic bases cannot roll them — worth a Craft of Exile spot check). Each class file lists its influence mods (`influence_mods`, without weights) so the parser can name them; it records them as `kind: "influence"` with `modId: null`, never resolves or tiers them. Fix when influence is in scope (v2): select mods by base tags plus each class's `item_classes.json` `influence_tags`, and add the weights back to `influence_mods`.
10. **`p90Attempts` is −0 when p = 1** (`ceil(log 0.1 / log 0)`), a POC quirk kept for parity. Treat p = 1 downstream.
11. **Base display names are not unique.** The ten Royale-mode copies are left out of `index.json` (they stay in the class files). The base id is the marker: eight of them carry `not_for_sale`, Crude Bow's and Driftwood Wand's copies do not, and the Fishing Rod carries the tag without being a copy, so it stays listed. Duplicated names remain: talisman variants, the three Two-Stone Rings, legacy quivers, Two-Toned Boots × 3 with different tags (so different pools), Energy Blade in both One Hand Sword and Two Hand Sword. `findBase` takes the first, same as the POC; none of the scenario bases is affected. **The parser resolves by item class, then implicit text, then attribute requirements** (real fixtures: a Two-Stone Ring and a Broadhead Arrow Quiver both resolved by implicit, each with a declared warning). When a corruption has replaced the implicit and the requirements do not differ (rings, amulets, quivers) it throws `AmbiguousBaseError` naming the candidates; the milestone 6 UI should offer the choice.
12. **Magic items 1/2 mod split, the 8c reroll's exact semantics, annulment vs fractured/crafted mods, recombinators in 3.29 core** [§9.3–9.6] — not reached yet (milestone 4). **Hybrid mods sharing a group with the plain mod** [§9.7]: the data can answer this per base in milestone 4; not examined.
13. **Amulet spell damage shows more tiers in the game than in the data. Still open.** A 3.29 paste shows "Thaumaturgist's" (18-22)% increased Spell Damage as "(Tier: 4)"; RePoE and Path of Building both carry five amulet spell damage tiers (Chanter's L5 to Wizard's (23-26) L76), which makes it T2 under the rule that matches all 46 other tiers seen. The ladder is single-type, so the per-type change does not touch it, and nothing in the data (influence, essence or Delve mods included) explains two extra tiers. Since 05/09/2026 the parser resolves the mod and records the disagreement as one warning (quoted in the fixtures section) with `tierCheck: "mismatch"`; fixture `rare-amulet-corrupted-vaal-implicit` declares it. Check on Craft of Exile or in game: how many "increased Spell Damage" prefix tiers does an amulet show?
14. **"(Rank: n)" on a bench craft appears to be the bench option's `bench_tier`.** Two data points now: Murder Mitts' "(Rank: 3)" Evasion/Energy Shield craft is `bench_tier` 3, and Cameron's staff "(Rank: 2)" Spell Critical Strike Chance craft is `bench_tier` 2. The parser records the rank and only warns when it differs.
15. **Unveiled mods print "(Tier: n)" but have no ladder.** Cane of Kulemak shows three "(Tier: 1)" unveiled mods, Cameron's Twilight Regalia one ("of the Order", cold and chaos resistance, Tier 1). The parser resolves them by name, side, text and ranges (`unveiled_mods`, filtered by the base's tags) and records the tier without checking it. If milestone 4 needs their tier, the same required_level ranking within `type` and side is the candidate rule; not applied.
16. **"Vestigial <base>" (3.29).** Two real pastes name the base "Vestigial Secutor Helm" / "Vestigial Crusader Plate" with a `{ Vestigial Implicit Modifier }`. The parser strips the word to find the base and sets `vestigial: true`; what the mechanic does to crafting is not modelled and the base's normal pool is assumed.
17. **Essence mods print no tier**, so the parser cannot confirm the value-based essence tier of VERIFY 3.
18. **Known-but-unrollable mods resolve instead of failing.** Real items carry mods no v1 action can roll: a 3.26 mercenary-domain glove suffix, an item-quantity amulet suffix with no spawn weight anywhere, and now a Delve fossil suffix (`DelveDexterityGemLevel1` on Cameron's Twilight Regalia, fractured). Rather than refuse such an item, the parser resolves them by exact name, side, text and ranges against `other_mods.json.gz` (several equal matches narrowed by the base's tags, else `AmbiguousModError`) and marks them `kind: "other"` with the domain and a warning; they occupy their slot. A name that matches nothing is still an `UnknownModError`. If a hard error is preferred here, it is one branch in `ModResolver.resolve`.
19. **Still-veiled mods** are handled in the format Path of Building's parser tests use (`{ Prefix Modifier "Veiled" }` / `Veiled Prefix`, and `"of the Veil"` / `Veiled Suffix`); no real paste with one was found, so it is unit-tested only.
20. **Essence scenarios sit off Craft of Exile's Calculator in a side-dependent pattern** (new, 05/09/2026). astral-greed −0.20%, astral-anger −1.75%, titan-zeal +2.71%, vaal-axe-zeal −3.25% relative to the Calculator, three of them outside our own 95% Monte Carlo interval, while every chaos/alch scenario is inside its interval. The one scenario whose forced mod shares the target's side is above the Calculator, the three whose forced mod is on the other side are below, which reads like the Calculator handling the forced mod's slot as an approximation rather than a simulation. CoE's own Simulator agrees with us on titan-zeal-life2 within noise (7.321% ± 0.093 over 300,000 essences vs our 7.382%). No change made; if the other three essence scenarios are ever run through the Simulator, the same agreement is expected. Worth doing before the solver ranks essence methods against chaos spam on margins under 3%.

Data facts worth knowing (not VERIFY): three unreleased StormBlade mods have `text: null` in RePoE and weight 0 everywhere (never written); GitHub Pages replicas stamp `mods.json` Last-Modified a couple of seconds apart, so it is provenance, not a change detector; `requirements` is `null` on every released Ring, Amulet, Belt and Quiver base (182) and is copied verbatim; resolved weights can be fractional (12.5, 87.5) because `generation_weights` are percentages; Delve-domain mods carry positive spawn weights in RePoE (e.g. `DelveDexterityGemLevel1` on 17 tags) that only apply through fossils, which is why they are in `other_mods`, not the class files; the `_readme` of `test/parity/scenarios.json` still says tiers are counted "at that ilvl" (true of the POC, superseded by VERIFY 8) and was left alone because the file's scenarios are fixed.

## Review pass and what it changed (milestones 1–2)

Five independent reviewers (port fidelity, pool equivalence, spec compliance, data completeness, price script) went over the first build, then three more over the fixes, each with throwaway scripts and a mock poe.ninja rather than by reading alone. Applied from the first round: the price script rejects empty bodies and implausibly shrunken sections instead of overwriting good prices; honours `Retry-After` and never retries plain 4xx; self-heals a torn cache file behind a 304; writes atomically; `deploy.yml` reacts to the cron commit; the cron restores the ETag cache and rebases before pushing; `requirements` is copied verbatim (was zero-filled); HiddenItem is skipped; essence-only weights are 0 by construction. Applied from the second round: the plausibility check runs inside the fetch so a rejected body is never cached and applies even when the previous section is stale (`--force` is the escape hatch); the Cache-Control-fresh path heals a torn cache too; the serialiser uses a function replacer (a `$&` in a base name would have corrupted the file); the case-insensitive league match uses `readdir` (Windows `existsSync` is case-insensitive); the cron workflow has a concurrency group so a manual dispatch cannot race the schedule into a merge conflict; three stale numbers in comments were corrected. Every fix was re-verified against the mock. Findings not acted on are in the VERIFY list above (5–11). The cron workflow those notes mention was removed in the fix-up below.

## Fix-up (05/09/2026, after the GitHub setup)

Three requested changes on branch `m1-m2-foundation`, verified with one focused pass per CLAUDE.md rule 8 (no reviewer agents): `npm test`, `npm run typecheck`, `npm run build`, the data build's own self-checks, a probe of every ladder for mods above L86, and the local poe.ninja mock for the price-script flags.

1. **Prices are fetched at deploy time, not committed.** `.github/workflows/snapshot-prices.yml` is deleted. `deploy.yml` now triggers on push to `main`, a 6-hourly schedule (`17 */6 * * *`) and manual dispatch, restores the ETag cache, runs `npm run snapshot-prices -- --league Allflame --force` before `npm run build` (with `continue-on-error`, so a poe.ninja hiccup ships the committed prices rather than blocking a deploy), and no longer has the `workflow_run` trigger. Because `--force` now runs on every deploy, its meaning was narrowed to the 30-minute guard and the Cache-Control shortcut; the "section shrank under half" rejection stays on, and a new `--accept-shrink` flag is the deliberate override. Mock-tested: 40% body with `--force` is still rejected and carried over stale; with `--accept-shrink` it is accepted.
2. **Tiers are independent of item level.** `buildPool` ranks each ladder over every mod that can roll on the base's tag set at any level and then takes the ilvl subset as the pool, so tier numbers match the in-game "(Tier: n)" and Craft of Exile. Draw order and weights are untouched. The pool test that asserted the old rule now asserts the new one. VERIFY 8.
3. **`index.json` drops the Royale copies.** Ten bases whose id contains "Royale" are left out of the index (still in the class files). VERIFY 11.

## Next

1. **Cameron:** merge this PR (parity stage 2, per-type tiers, fixtures) once CI is green, then tag it without switching: `git fetch origin && git tag -a m2-parity origin/main -m "Parity stage 2: 10/10 against Craft of Exile; tiers per type" && git push origin --tags`. (`m3-parser` can be tagged on `d46ac9c` the same way if not done yet.)
2. **Milestone 4 + 5** (actions, abstract state, solver) as the next prompt from Cowork (HANDOVER Step C, ultracode on). The parser gives it `Item.mods[].modId`, `kind`, `flags`, `metamods`, `open*`, `influences` and `warnings`; `kind: "influence" | "other"` mods occupy a slot and cannot be rolled by v1 actions; a `tierCheck: "mismatch"` mod is still the right mod. Target picks on a multi-type group need a `type` (ladder section).
3. **Optional one-minute checks on Craft of Exile:** VERIFY 13 (how many spell damage prefix tiers on an amulet?) and VERIFY 20 (run astral-greed, astral-anger and vaal-axe-zeal through the Simulator).

## Files

Scaffold: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.github/ruleset-main.json`, `.claude/settings.json`, `.claude/hooks/guard.mjs`, `.claude/hooks/autosave.mjs`, `.gitattributes`, `.gitignore` (+ `.cache/`).
Scripts: `scripts/build-data.ts`, `scripts/snapshot-prices.ts`.
Engine: `src/engine/types.ts`, `src/engine/rng.ts`, `src/engine/pool.ts`, `src/engine/roll.ts`; `src/prices/types.ts`.
Parser: `src/parse/itemText.ts`, `src/parse/errors.ts`, `src/parse/text.ts`, `src/parse/types.ts`.
Tests: `test/engine/rng.test.ts`, `test/engine/roll.test.ts`, `test/engine/pool.test.ts`, `test/parity/parity.test.ts`, `test/parse/fixtures.test.ts`, `test/parse/itemText.test.ts`, `test/helpers/data.ts`; fixtures `test/fixtures/items/*.txt` (22).
Generated, committed: `public/data/*.json.gz` (25 class files + `other_mods.json.gz`) + `index.json`, `public/prices/Allflame.json`, `poc/results.json` (regenerated 05/09/2026 with the Royale exclusion).
Edited under authorisation: `poc/engine.mjs` (one Royale exclusion line + comment, 05/09/2026); `test/parity/scenarios.json` (`coe_p` values and one `_readme` entry only). Untouched: `BRIEF.md`. `CLAUDE.md`: the tier sentence in Conventions now says (group, side, type). `HANDOVER.md` carries Cameron's Step A–D walkthrough.

Commands: `npm run build-data`, `npm run snapshot-prices` (`-- --force` to skip the 30-minute guard, `-- --accept-shrink` to accept a halved section), `npm test` (`PARITY_EXACT=1` for hard exact-hit assertions), `npm run typecheck`, `npm run build`, `npm run dev`.
