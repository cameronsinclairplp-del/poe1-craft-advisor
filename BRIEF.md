# poe1-craft-advisor — build brief

Written 05/09/2026. PoE 1 patch 3.29 (Curse of the Allflame), trade league "Allflame".
Hand this file to Claude Code as the project spec. Everything marked **VERIFY** is a fact I could not confirm; check it before you rely on it.
Revised the same day after reading the Reddit post and its comments: §1, §3 Layer 2, §4 prior art, §5 scope, §8 risks.

---

## 1. What CraftGaz actually is

From craftgaz.com and the author's Reddit post/comments (u/Civil-Bee-f, r/PathOfExile2, "I 'solved' crafting with Math"):

- **Constructor** — you draw a crafting plan as a branching graph. A Monte Carlo engine runs it 20,000 times and reports probability, expected attempts, expected cost and expected profit per branch.
- **Advisor** — paste an item, pick "must have" mods and optional "fillers", set a budget. It returns the best *next* action, expected profit, whether to keep crafting or sell, whether the budget is realistic, and cost-to-finish as average / median / p90 / worst.
- **The method, in the author's words:** "The crafting problem is modeled as a Markov decision process (MDP) and solved using Bellman equations. Each item is treated as a state, while currencies and crafting methods are possible actions. The model evaluates the possible outcomes and searches for the route with the highest expected profit."
- **State space:** "it explodes — so the state is abstract: per-dimension counters of caught target mods + junk occupancy per side, not literal items. Keeps a base at ~50–100k states, solvable exactly." The user's picks become the dimensions, capped by a state-count budget. Main lever: merge interchangeable mods into one pick ("3 resists as one pick is ~5k states vs ~45k as three").
- **Objective:** expected profit, not just cost. gamma = 1 ("currency doesn't decay"); time is charged as a flat per-click cost added to every action, with presets for your click price.
- **Pricing ("Market" mode):** scrapes trade listings, uses "the 10th percentile of offers from unique traders as the price", with a minimum-sellers gate because "an ask isn't a trade". Does not value individual mods, only combinations. Only three boot bases supported. Author calls this the hard part.
- **Compute:** server-side, queued, some runs 10–20 minutes; frequent bases pre-solved at release.
- **Limits:** no routes from normal/magic items, no Divine rolling, no runes, many essences missing, no jewellery, whittling not in the MDP.
- **Code:** not public. Heavy "vibe-coded" accusations in the thread; the author says an LLM is not involved in the solve ("would drain my bank account").
- **Lineage:** the author was inspired by Denny Britz's 13/07/2024 post "Solving Path of Exile item crafting with Reinforcement Learning" (dennybritz.com/posts/poe-crafting). That post is **PoE 1** (Boneshatter axe, Cobalt Jewel examples): featurised state = bitstring of which target mods are present + prefix/suffix counts; a model learned by sampling each (state, action) 10⁵ times; Q-value iteration; gamma = 1; costs from poe.ninja; essences, annul, regal, alt/aug, bench, metamods. Rust, no repo. His stated gap: the state doesn't record which junk mods are on the item, so metamod interactions ("cannot roll attack mods") drift from reality; fractured and veiled mods unsupported.

So the maths is settled and public: abstract-state MDP, exact value iteration, gamma 1, Monte Carlo to learn transitions where there's no closed form. Nobody has shipped it for PoE 1 as a web tool. §3 is that method with the two authors' fixes folded in.

## 2. What we are building

A static web app for PoE 1: paste an item (Ctrl+Alt+C), describe the target, get the optimal next step, expected cost-to-finish, the cost distribution, and the chance of finishing inside your budget. Prices from a poe.ninja snapshot. All maths runs in the browser.

Why this is not a Craft of Exile clone: CoE's Calculator answers "what are the odds and cost of method X for target Y from a fresh base", and its Emulator lets you apply currency by hand. Neither chooses between methods, sequences them, or tells you what to do with the item you are holding right now. That gap (state-aware, policy-optimal, "what do I do *now*") is the whole product. The 3.29 bench crafts "reroll 3 random mods for 3c" and "reroll 1 random mod for 8c" make it more valuable, because they are state-dependent decisions nobody has odds for.

## 3. The maths — three layers

### Layer 1 — outcome distributions from game weights (exact where possible)

A rare roll draws mods one at a time from the eligible pool: domain `item`, prefix/suffix, `required_level ≤ ilvl`, spawn weight > 0 for the base's tag set, group not already on the item, side not full (max 3 each). Each draw is weighted by `spawn_weight × generation_weight`. Mods already placed can add tags (`adds_tags`) that change later draws.

- Number of affixes on a fresh rare: 4 / 5 / 6 with weights 8 / 3 / 1 (jewels differ). **VERIFY** against Craft of Exile before trusting any absolute number.
- Single-mod actions (exalt, augment, regal, annul, harvest augment, the 8c bench reroll) have exact closed forms: P(add group g at tier ≥ k) = Σ qualifying weights ÷ Σ eligible weights, given blocked groups and open sides. Annul = uniform over removable mods.
- Full rerolls (chaos, alch, essence, fossil, harvest reforge) are computed by Monte Carlo once per (action, constraints) and bucketed into abstract outcomes. 1e5 rolls takes well under a second in a Web Worker and is cached.

### Layer 2 — abstract-state MDP solved by value iteration

Do not track the concrete item (millions of states). Track only what the target cares about, the same idea as Britz and Civil-Bee-f, with the gap Britz named closed:

```
state = (
  rarity,                               // normal | magic | rare
  status[each target pick],             // absent | below-tier | ok | ok+fractured
                                        //   a pick can be "k of {fire, cold, light} res ≥ T2" — one counter, not three slots
  junkPrefixes, junkSuffixes,           // 0..3 each (occupancy per side)
  junkTagFlags,                         // has-attack-junk, has-caster-junk — only what metamods care about
  craftedCount,                         // bench mods on item
  metamod,                              // none | prefixes-locked | suffixes-locked | no-attack | no-caster
  influence flags
)
```

Britz's featurised state ignored what the junk *was*, so "Cannot roll Attack Modifiers" behaved wrongly in practice. Two boolean tag flags fix that at negligible cost. Civil-Bee-f's merge trick (interchangeable mods as one pick) is what keeps the count sane; expect thousands to ~100k states per base, all solvable exactly.

Solve with "sell" and "finish" as terminal values so cost-only and profit modes are one solver:

```
V(s) = max over a in A(s) [ −cost(a) − clickCost + Σ P(s' | s, a) · V(s') ]
A(s) always includes  sell(s) -> value(s)       // 0 if the market pays nothing for this state
finished(s)           -> V = value(target)      // or a large constant M when you only care about cost
```

gamma = 1; a flat `clickCost` per action (chaos per click, user preset) stops the solver recommending 900 alt clicks to save 5c. Value iteration until the change is under 0.01 chaos. Include "scour" and "buy a fresh base" as actions so the solver can decide when to give up on an item. Actions that can't apply in a state (exalt on a full item, chaos on a magic item, anything on a fractured slot) are absent from A(s). Full-reroll actions are "afterstates" (Britz): their outcome distribution does not depend on the current item, so compute once per (action, constraints) and reuse everywhere.

Output: the argmax action at the current state is the **next step**; V(s) is the **expected profit** (or −expected cost); the full argmax table is the **plan**. "Alternative targets" are just extra terminal states with a sell value — that is the author's most useful tip ("accept a wider range of valuable mod combinations than your own build requires") and it costs nothing once the solver exists.

One correction to the site's help text: it says the Advisor decides "on the most likely outcome of every step". The Reddit comments make clear the real thing is a full Bellman solve. Build the full solve; it is cheap at this state size.

### Layer 3 — rollouts for distributions and budget

Simulate the optimal policy 20,000 times from the current state using the cached transition tables. Report mean, median, p90, worst-of-run, and P(finished within budget B). Craft-vs-buy compares V(s) + base cost against a buy price the user types in (there is no public price API for PoE 1 rares; poe.ninja does not price them).

v2, not v1: budget-aware objective (maximise P(finish ≤ B) instead of min expected cost) by adding a coarse remaining-budget dimension to the state.

## 4. Data sources — all verified live on 05/09/2026

| Need | Source | Notes |
|---|---|---|
| Mods, weights, tiers, tags | `https://repoe-fork.github.io/mods.json` (34 MB) | PoE 1 files live at the root, **not** `/RePoE/data/`. CORS `*`. Last-modified 04/09/2026. Contains 3.29 content (Ducat-crafted mods, deepwater domains), so it is current. 40,355 mods; 4,369 are item-domain prefix/suffix. |
| Bases | `https://repoe-fork.github.io/base_items.json` (8 MB) | Tags per base drive weight resolution. `release_state`, `item_class`, `drop_level`, implicits. |
| Essences | `https://repoe-fork.github.io/essences.json` | Maps essence → forced mod id per item class, tier, corruption-only flag. 106 essences. |
| Fossils | `https://repoe-fork.github.io/fossils.json` | positive/negative weight tags, forced/added mods, forbidden tags, lucky rolls. |
| Bench crafts + metamods | `https://repoe-fork.github.io/crafting_bench_options.json` | 765 options with costs and item classes. Includes the 3.29 rerolls: `reroll_rare_mods: 3` for 3 chaos and `reroll_rare_mods: 1` for 8 chaos. Metamods are in `mods.json` under domain `crafted` (e.g. `StrMasterItemGenerationCannotChangePrefixes`). |
| Mod groups/types, tags | `mod_types.json`, `tags.json`, `item_classes.json` | Same host. |
| Veiled/unveiled pools | `mods.json` domains `veiled`, `unveiled` | For Veiled Orb / Aisling later. |
| Prices | poe.ninja documented API (`https://poe.ninja/docs/api`) | `GET https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Allflame&type=Currency` (also `Essence`, `Fossil`, `Resonator`, `Fragment`, `Scarab`, `Oil`, …). Bases and beasts: `GET https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Allflame&type=BaseType` (or `Beast`). Leagues: `GET https://poe.ninja/poe1/api/economy/leagues`. Response `lines[].primaryValue` is chaos-per-unit; `items[]` maps id → name. Cache-Control is 30 min with ETag. Their rules: descriptive User-Agent, do not poll faster than minutes, proxy through your own backend (we snapshot instead), no stability guarantee. The old `/api/data/currencyoverview` endpoints are dead (404). |
| Reference / parity | Craft of Exile (updated for 3.29), poedb Modifiers | Ground truth for odds. No API. |

Not in RePoE (hand-code from the wiki): Harvest bench options, beastcraft recipes, Awakener's Orb / influence-exalt rules, eldritch implicit tiers by ilvl.

Prior art worth reading before coding:

- **dennybritz.com/posts/poe-crafting** (13/07/2024) — the PoE 1 MDP write-up CraftGaz descends from. Read it first. Featurised state, model learned by sampling, Q-value iteration, poe.ninja costs, worked Boneshatter axe and Cobalt Jewel examples. Rust, no repo.
- `github.com/doomeer/kalandralang` (MIT, OCaml) — a DSL + Monte Carlo cost simulator for PoE 1 that already models essences, fossils, bench, harvest, beast imprint/split, Aisling, awakener, eldritch, fracturing and partial recombinators. A recipe *simulator* (you write the plan), not an advisor. Steal its mechanic notes; do not port the code.
- poestash.com/poe1/craft-simulator — browser simulator that chains steps (essences, fossils, harvest, bench, veil, beasts, eldritch, core orbs) and reports odds and cost. Simulator, not advisor. Useful as a second parity reference beside Craft of Exile.

## 5. Scope — cut hard or it never ships

**v1 (the thing that proves the idea):**
Rares on non-influenced armour, weapons, jewellery. Actions: Transmutation, Alteration, Augmentation, Regal, Chaos, Alchemy, Scouring, Exalted, Annulment; all essences (incl. corrupted); bench add/remove crafted mod; the four metamods and how they change chaos/scour/annul behaviour; the 3.29 bench rerolls (3c and 8c); "buy fresh base"; "sell". Targets are tier-based ("T2 life or better"), with "k of n" picks. Prices for the target and any alternative targets are typed in by the user ("My Target" mode). Divine Orbs are out of scope.

Note what this already beats: CraftGaz cannot start from a normal or magic item, so it never sees alt-regal routes. In PoE 1 those are the cheap routes, and the alt/aug/regal actions above cover them.

**v2:** Fossils + resonators, Harvest reforge variants, Veiled Orb / Aisling unveils, influenced bases with conqueror exalts and Awakener's Orb, beast imprint/split, eldritch implicits (independent sub-problem), budget-aware objective, trade-link builder for the buy side (reuse `la-trade-links`).

**v3 ("Market" mode):** price outcomes automatically instead of by hand. Civil-Bee-f's recipe: official trade API search per sellable combination, 10th percentile of asks from distinct sellers, ignore any combination with fewer than N sellers, precompute per base. PoE 1's official trade API has rate limits that make "price every outcome" slow, which is exactly why he pre-solves frequent bases. Treat this as its own project.

**Never (or only if you personally want them):** recombinators (**VERIFY** whether they are even in 3.29 core), Ducats and Enshrouding Crystals (3.29 league-only; the 39 `ducat_crafted` mods are aspects, deepwater trap/mine mods and tattoo enchants), tainted/corruption crafting, synthesis, cluster jewels, flasks, maps, jewels with their own affix rules.

## 6. Architecture

Static site, TypeScript, Vite, Preact or React, GitHub Pages. No backend. Solver in a Web Worker.

```
poe1-craft-advisor/
  scripts/
    build-data.ts        # RePoE fork -> public/data/<ItemClass>.json.gz (pools, tiers, weights, essences, bench, fossils)
    snapshot-prices.ts   # poe.ninja -> public/prices/<league>.json   (run by GitHub Actions cron, every 6 h)
  src/
    parse/itemText.ts    # Ctrl+Alt+C advanced item text -> Item {base, ilvl, rarity, mods[{name, group, tier, side, flags}]}
    engine/pool.ts       # buildPool(base, ilvl, influences) — weight resolution, tiering, adds_tags
    engine/roll.ts       # rollRare / rollMagic / single-mod add / annul / metamod-aware variants
    engine/actions.ts    # Action registry: applicability(state), cost(prices), transition(state) -> outcome distribution
    solver/abstract.ts   # Item + Target -> abstract state; outcome -> abstract state bucketing
    solver/mdp.ts        # value iteration; policy; V(s)
    solver/rollout.ts    # policy simulation -> mean / median / p90 / worst / P(<= budget)
    ui/                  # paste box, target builder, next-step card, plan table, distribution chart, craft-vs-buy
  test/
    fixtures/items/*.txt # real Ctrl+Alt+C pastes
    parity/*.json        # scenarios with Craft of Exile numbers to match
  poc/engine.mjs         # the proof of concept that ships with this brief
```

Data files are built at dev time and committed. Re-run `build-data` after every patch (the RePoE fork updates within days). Prices are snapshotted, never fetched from the browser (CORS and poe.ninja's rules both say so).

Item paste: use Ctrl+Alt+C, not Ctrl+C. The advanced format prints each mod with its name and `(Tier: n)`, plus Prefix/Suffix, Fractured, Crafted, Implicit, Eldritch markers. That maps straight onto RePoE mod names + groups; plain Ctrl+C would force you to reverse-engineer tiers from values.

## 7. Build order — each milestone has a pass/fail check

1. **Data build.** `build-data.ts` produces per-class pool files. Check: Astral Plate ilvl 86 yields 109 rollable mods; life prefixes tier T1 = 175–189 (L86), T2 = 160–174 (L81); fire res T1 = 46–48% (L84). Those numbers come from the POC and match poedb.
2. **Roll engine + parity.** Port `poc/engine.mjs` to TS. The 10 scenarios are already defined in `test/parity/scenarios.json` (`coe_p` blank, to be filled from Craft of Exile) and the POC's own numbers for them are in `poc/results.json`. Check: the TS engine reproduces `poc_p` within Monte Carlo noise, then matches `coe_p` within ±5% relative once filled. If CoE disagrees, the culprit is almost certainly the 4/5/6 split, the essence slot rule, essence-mod tiering, or group/adds_tags handling. Fix before going further — nothing downstream is trustworthy until this passes.
3. **Parser.** Ctrl+Alt+C fixtures for 15 real items (rare, magic, normal, with crafted, fractured, metamod, influenced). Check: 100% of fixtures parse to the right base/ilvl/mods/tiers.
4. **Actions + abstract state.** Every v1 action implemented as applicability + cost + transition. Check: for each action, Σ P(s') = 1 ± 1e-9, and a Monte Carlo of the concrete engine agrees with the abstract transition table within noise.
5. **Solver.** Value iteration + policy. Check: on a target reachable only by essence spam, M − V(fresh base) ≈ essence price ÷ p; on "T1 life + T1 res" the policy prefers cheaper essence over chaos when prices say so; with a sell value on an alternative target the policy sells when it hits it; V from rollouts matches V from iteration; state count per base stays under ~100k with the merge trick on.
6. **UI.** Paste → target → next step + cost + distribution + P(≤ budget). Ship on GitHub Pages.
7. **v2 features** in the order they matter to what you actually craft.

## 8. Risks and blind spots

1. **Scope creep is the killer.** PoE 1 has ten-plus crafting systems. v1 has one job: currency + essences + bench, parity-tested. Add systems one at a time, each with its own parity scenarios.
2. **Ground truth.** Craft of Exile is the only reference. If your numbers disagree with it, users will trust CoE, and they should. Milestone 2 is non-negotiable.
3. **League timing.** Allflame is late (3.29.3 landed 12/08/2026; ExileCon qualifiers are running). 3.30 will change mods, currency and possibly the bench. The data pipeline must be a 10-minute re-run, not hand-maintained JSON.
4. **Prices.** The poe.ninja economy API is documented but explicitly has no stability guarantee. Snapshot via Actions, fail soft (stale prices with a timestamp) rather than break the app.
5. **Tiering.** Ranking by `required_level` within a group works for plain mods. Hybrid groups and influence mods can break it. Validate per item class against poedb, and let the UI show the mod text with the tier so a wrong tier is visible.
6. **Values vs tiers.** "T1 life" is 175–189, not 189. v1 targets tiers. Say so in the UI or people will think the tool is wrong.
7. **Pricing is the real bottleneck, not the MDP.** One commenter put it exactly: "If you had prices for all possible outcomes solving the MDP would be trivial because you could bootstrap from any state without rollout." The maths is the easy half. v1 dodges it with typed-in prices; anything automatic is v3 and a project of its own.
8. **State-count discipline.** Every extra target pick multiplies the state space. Cap picks (Civil-Bee-f caps them and adds a state budget), merge interchangeable mods, and show the user the state count so they understand why "any 5 T1 mods" is not a valid target.

## 9. VERIFY list

- Affix count weights on a fresh rare: 4/5/6 at 8/3/1. Jewels 3/4 split.
- Does an essence's forced mod count inside that N, or does the item get the essence mod plus N random mods? (POC assumes it counts inside N.)
- Magic items: split between 1 and 2 mods on transmute/alteration.
- The 3.29 "Reroll a random Modifier on a Rare Item (8c)": replaces one mod with a new random mod, or rerolls that mod's values? Does it respect metamods and fractured mods?
- Annulment vs fractured mods (cannot remove) and crafted mods (can remove?).
- Are recombinators in the 3.29 core game?
- Whether hybrid mods (e.g. armour + stun recovery) share a group with the plain mod on any base.

## 10. Proof of concept — what already runs

`poc/engine.mjs` (Node 18+, no dependencies, `node engine.mjs`) does the whole pipeline: downloads the RePoE fork data and poe.ninja prices, builds the Astral Plate ilvl 86 pool with tiers, rolls rares with the sequential weighted draw, and compares methods for the target "life ≥ T2 and fire res ≥ T2".

Output on 05/09/2026 (Allflame, Divine = 452.1c, base ≈ 15c, 200,000 rolls per method):

| Method | p / attempt | E[attempts] | cost / attempt | E[cost] | p90 cost |
|---|---|---|---|---|---|
| Deafening Essence of Greed spam | 7.56% | 13.2 | 4.34c | 57c (0.13 div) | 130c |
| Deafening Essence of Anger spam | 7.38% | 13.5 | 4.96c | 67c (0.15 div) | 154c |
| Chaos spam | 0.63% | 159.2 | 1.00c | 159c (0.35 div) | 366c |

That is the advisor's answer for a fresh base: Greed essence, not chaos. The abstract-state solver in §3 is what turns this single comparison into "best next step" for an item mid-craft, and adds the alt-regal routes CraftGaz skips.

`node engine.mjs --scenarios ../test/parity/scenarios.json --out results.json` runs the 10 parity scenarios (about 4 minutes; two low-probability weapon scenarios use 2M rolls) and writes `poc/results.json` with p, hits, 95% CI and expected cost per scenario. Two of them were cross-checked against an independent Python implementation of the same rules and agreed within noise. Those are the numbers the TS port must reproduce before Craft of Exile is even consulted.

## 11. Prompt for Claude Code

```
Read BRIEF.md in full. We are building milestone 1 and 2 only.
1. Scaffold the repo layout in §6 (Vite + TypeScript + Preact, GitHub Pages deploy workflow).
2. Write scripts/build-data.ts: download the RePoE fork files listed in §4, build per-item-class
   pool files (mods with id, name, text, side, group, type, required_level, spawn/generation weights
   by tag, adds_tags, stats min/max, essence-only flag; tiers per base tag-set; essences; bench
   options; fossils). Gzip to public/data/. Print the Astral Plate ilvl 86 check from §7.1.
3. Port poc/engine.mjs to src/engine/{pool,roll}.ts with the same behaviour and a seedable RNG.
4. Write the parity test around test/parity/scenarios.json (already written, do not change the
   scenarios). Stage 1: the TS engine must reproduce poc/results.json poc_p within 2× the stated
   95% CI. Stage 2: when coe_p is filled in, match it within ±5% relative; until then, report
   those scenarios as PENDING, not failing.
Do not start the solver or the UI until parity passes. Flag every VERIFY item you hit.
```
