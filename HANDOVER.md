# Handover — the one place to look

Updated 05/09/2026 (evening). Step B now merges PR #2 itself, then does parity numbers, per-type tier ladders and your three items in one go. Written for Claude Code inside the Claude desktop app (Fable 5.1). You paste prompts; it runs the commands.

## Where things are

| | |
|---|---|
| Done | Foundation (M1–2), GitHub + safety net, M3 parser (PR #2, open). Parity numbers read off Craft of Exile by Cowork (all ten within 3.2%). Your three 3.29 items received 05/09/2026 (staff, Twilight Regalia, magic Titan Plate). |
| Now | Run Step B (it merges PR #2 first) → merge PR #3, tag `m2-parity` → run Step C (M4+M5, ultracode on). |
| Finished means | You paste an item, pick a target, get the next step, cost and odds, on the Pages site. Step D (UI) after Step C. |

## The finish line, step by step

**Step A — done 05/09/2026.** PR #1 merged (9976b87), milestone 3 parser built on `m3-parser` with 19 public fixtures, PR #2 open. The prompt is in this file's git history.

**Step B — parity numbers, per-type tiers, your three items (new session, `/effort high`, no workflows).** Cowork read all ten scenarios off Craft of Exile (Calculator, patch 3.29 data) and found one data bug on the way: four Royale-only mods carry normal spawn weights in RePoE and were polluting our pools. Your three items are the first 3.29 items with in-game tier numbers the parser has seen; Cowork checked them against RePoE: the magic Titan Plate already matches (Vigorous = Tier 3, of Thick Skin = Tier 6), the staff needs the per-type ladder (Stone Singer's is Tier 1 in game, Tier 5 on our ladder today), and the Twilight Regalia's fractured suffix is a Delve mod the pool can never roll.

How to paste: copy the block below into Claude Code, then paste the three items straight under it (copy them from the Cowork chat, or Ctrl+Alt+C each one in game again) and send. Everything in one message.

```
Parity stage 2, per-type tier ladders, and Cameron's three items. Read CLAUDE.md and STATUS.md first.

0. Housekeeping. If the working tree is not clean (HANDOVER.md), commit it on the current branch
   and push. Then `gh pr view 2 --json state,statusCheckRollup`: if PR #2 is OPEN and its checks
   are green, `gh pr merge 2 --squash --auto` and poll `gh pr view 2 --json state` until MERGED;
   if a check is red, report it and stop. Then
   `git fetch origin && git switch -c parity-tiers origin/main`.

1. Royale mods out. In scripts/build-data.ts exclude every mod whose id contains "Royale"
   (four of them: MovementVelocity2Royale, IncreasedCastSpeed2Royale,
   LocalIncreasedAttackSpeed2Royale____, IncreasedAttackSpeed2Royale). They never roll outside
   the Royale event; Craft of Exile excludes them, and with them out our pool weights match CoE
   exactly on all four parity bases (Astral 45500/58200, Titan 39000/56600, Vaal 49614/61750,
   Amethyst 60250/103600 prefix/suffix). Add a data test that asserts no mod id containing
   "Royale" is in any class file.

2. Same one-line exclusion in poc/engine.mjs buildPool (Cameron authorises this edit to poc/:
   `if (id.includes("Royale")) continue;` right after the generation_type check, with a comment).
   Regenerate: `cd poc && node engine.mjs --scenarios ../test/parity/scenarios.json --out results.json`
   (about 3 minutes). Same seed, so expect these exact hit counts: astral-chaos 1256,
   astral-alch 1256, astral-greed 15120, astral-anger 14763, astral-life1 8120,
   titan-chaos 1518, titan-zeal 14764, vaal-chaos 6603, vaal-zeal 5902, amethyst 1042.

3. Fill coe_p in test/parity/scenarios.json (change nothing else in the scenarios):
   astral-chaos-life2-fire2 0.00631 | astral-alch-life2-fire2 0.00631 |
   astral-greed-life2-fire2 0.07575 | astral-anger-life2-fire2 0.07513 |
   astral-chaos-life1 0.04002 | titan-chaos-ms2-life2 0.00763 | titan-zeal-life2 0.07187 |
   vaal-axe-chaos-phys2 0.00329 | vaal-axe-zeal-phys2 0.00305 | amethyst-chaos-2of3res2 0.00521
   Add to the file's _readme: "coe_p read from craftofexile.com (3.29 data) on 05/09/2026 via
   the Calculator. amethyst is derived by inclusion-exclusion: P(fire AND cold)=0.176%, same for
   the other pairs by symmetry, P(all three)=0.003565%, so P(>=2 of 3)=3*0.1761-2*0.003565=0.521%.
   titan-zeal-life2 was also run through CoE's Simulator (300,000 essences): 7.321% +-0.093;
   the Calculator is an approximation for essences, the Simulator is the emulation, and our
   engine agrees with the Simulator within noise."

4. Tier ladders per type. Change the tier ranking from (group, side) to (group, side, type),
   type being RePoE `type`, still over the mods that can roll on the base's tag set at any ilvl.
   Today families that share a group but not a stat share one ladder: on a staff the five
   "+4 to Level of all <X> Spell Skill Gems" prefixes (group IncreaseSpecificSocketedGemLevel)
   all sit at level 77, so "Stone Singer's" comes out Tier 5 where the game says Tier 1. Per type
   it is Stone Singer's 1, Tecton's 2, Lithomancer's 3. The ten parity scenarios only touch
   single-type groups, so no parity tier may move; `npm test` proves it. Update the tier
   sentence in CLAUDE.md Conventions to say (group, side, type). Rebuild public/data once, after
   items 1 and 4. Then make the parser's "(Tier: n)" cross-check a WARNING recorded on the
   parsed item, never a throw: resolution is by name + side + text, the number is informational.
   The VERIFY 13 amulet fixture (`# expect-error: TierMismatchError`) now parses with one
   warning; change its expectation to that and assert it in the test. VERIFY 13 itself stays
   open: RePoE and Path of Building both give amulet spell damage five tiers, the game printed
   Tier 4 on a 3.29 item, and nothing in the data (influence, essence or Delve mods included)
   explains it.

5. Cameron's three items are pasted under this prompt, each block starting at "Item Class:".
   One of them may have a chat sentence pasted inside its Requirements block (starts "these are
   the items"); drop that line only. Save them otherwise verbatim as
   test/fixtures/items/rare-staff-crafted-rank-gem-level.txt,
   rare-body-armour-fractured-delve-eldritch-heist-enchant.txt and
   magic-body-armour-prefix-suffix.txt, first line `# source: own stash, 05/09/2026`, then a
   `# note:` line in the style of the other fixtures. Expected, checked by Cowork against RePoE:
   - Imperial Staff "Woe Bane": "Stone Singer's" = GlobalPhysicalSpellGemsLevelTwoHand3, Tier 1
     after item 4, no warning. The bench craft is headed "(Rank: n)": crafted, no tier check.
   - Titan Plate (magic, "Vigorous Titan Plate of Thick Skin"): "Vigorous" = IncreasedLife10
     Tier 3, "of Thick Skin" = StunRecovery1 Tier 6, both match already. Values print as
     149(145-159).
   - Twilight Regalia "Apocalypse Coat": Searing Exarch and Eater of Worlds implicits; an enchant
     "8% increased Explicit Defence Modifier magnitudes" (a Heist armour enchant,
     RePoE ArmourEnchantmentHeistDefenceEffect1) kept as an enchant, and the "— 8% Increased" it
     appends to the defence mod headers is display-only, same shape as the Simplex Amulet
     fixture; a Master Crafted hybrid attribute suffix; "Fractured Item" footer; and the
     fractured suffix "of the Underground" is a Delve mod: fossil-only, spawn weight 0 on every
     tag, so it is in no class file but is in other_mods (136 entries share that name; match by
     side + text, and if the text is shared across item classes disambiguate by the mod's
     spawn tags). Expected result: kind "other", flagged fractured, the existing "no v1 action
     can roll it" warning, no error.
   Fix the parser where these need it; no engine changes. Anything that will not resolve goes
   in STATUS.md with the exact line, not a guess.

6. `npm test` — parity stage 1 (POC reproduction) and stage 2 (CoE) both 10/10, every fixture
   parses. `npm run typecheck`, `npm run build`. STATUS.md: parity section with the final table,
   VERIFY 1 (affix split) and VERIFY 2 (essence slot rule) confirmed by parity, a new VERIFY note
   that essence scenarios sit 1.8-3.2% off CoE's Calculator in a side-dependent pattern while
   CoE's own Simulator agrees with us, VERIFY 7 closed by the per-type ladder with the three
   staff tiers as evidence, VERIFY 13 still open, the three new fixtures and every warning they
   raised (quote the lines). Commit "Parity stage 2, per-type tiers, Cameron's fixtures; Royale
   mods excluded", push, `gh pr create --fill --base main`. Stop.
```

Expected result (Cowork's POC after the Royale fix vs Craft of Exile): every scenario within 3.2%, seven of ten within 1.5%. If stage 2 fails on anything, or a fixture will not parse, paste the report to Cowork.

When it stops with PR #3, paste this (same session is fine):

```
PR #3 is done. Merge it and tag it.
1. `gh pr view 3 --json state,statusCheckRollup`. If the checks are green, `gh pr merge 3 --squash --auto`
   and poll `gh pr view 3 --json state` until MERGED. If a check is red, report why and stop.
2. Without switching branches: `git fetch origin && git tag -a m2-parity origin/main -m "Engine matches Craft of Exile" && git push origin --tags`.
3. Report the merge commit and the tag. Stop.
```

**Step C — milestones 4 + 5: actions, abstract state, solver (new session, ultracode ON).** Paste after PR #3 is merged and tagged:

```
Read CLAUDE.md, STATUS.md, then BRIEF.md §3 (all three layers), §5 v1 scope and §7 milestones
4–5. `git fetch origin && git switch -c m4-m5-solver origin/main`. Verification budget: one
adversarial workflow over the finished solver, not a swarm per change; say what ran in STATUS.md.

1. Milestone 4, actions. src/engine/actions.ts: a registry where every action has
   applicability(state), cost(prices) and transition(state) → outcome distribution. v1 set:
   Transmutation, Alteration, Augmentation, Regal, Chaos, Alchemy, Scouring, Exalted, Annulment;
   every essence in the class file; bench add crafted mod (each bench option from the class file,
   cost from crafting_bench_options, one crafted slot unless the multimod metamod is on);
   bench remove crafted mods; the four metamods (Prefixes/Suffixes Cannot Be Changed, Cannot roll
   Attack/Caster Modifiers) with their effect on chaos, scour, alt, annul, exalt, regal and the
   rerolls; the 3.29 bench rerolls (3 mods for 3c, 1 mod for 8c: implement as "remove k random
   removable explicit mods, then add k random eligible mods", marked VERIFY 3.29-REROLL until
   Cameron confirms in game); buy fresh base (cost = BaseType price from the snapshot, else
   user-entered); sell (value from the target spec, 0 by default).
   Rules to encode, each marked VERIFY where BRIEF §9 says so: magic items hold 1–2 mods
   (transmute/alt split VERIFY — fetch craftofexile.com's Basics/Advanced page for the number;
   if unavailable use 50/50 and flag it); annul cannot remove fractured mods and can remove crafted
   ones; scour keeps fractured mods; metamods block their side from chaos/scour/alt/annul as the
   game does; "cannot roll attack/caster" removes mods carrying the attack/caster tag
   (RePoE implicit_tags) from the eligible pool.

2. Abstract state. src/solver/abstract.ts exactly as BRIEF §3 Layer 2: rarity, per-pick status
   (absent | below-tier | ok | ok+fractured; a pick may be "k of n"), junk prefix/suffix counts,
   junk attack/caster flags, craftedCount, metamod, influence. Plus one thing the brief does not
   spell out: fractured mods that are not picks are permanent junk. Chaos, scour, annul and the
   rerolls cannot remove them, they hold their slot forever and count against the three per side.
   Carry them as fractured junk counts per side, separate from removable junk. The parser already
   marks mods the pool cannot produce (kind "other", e.g. the fractured Delve suffix on the
   Twilight Regalia fixture); the state must accept those on the item without trying to roll
   them. Concrete Item + Target → state; outcome → state. Single-mod actions get exact
   closed-form transitions from pool weights (blocked groups, open sides, metamod tag
   exclusions); full rerolls get Monte Carlo transitions computed once per (action, constraints)
   and cached (afterstates). Every transition's probabilities sum to 1 within 1e-9, and a Monte
   Carlo of the concrete engine must agree with the abstract table within noise for every action;
   that is the milestone 4 test. Item → state must work on all three of Cameron's fixtures
   (test/fixtures/items/rare-staff-*, rare-body-armour-fractured-*, magic-body-armour-*).

3. Milestone 5, solver. src/solver/mdp.ts: value iteration with sell and finish as terminal
   values, gamma = 1, a per-click cost (default 0.1c, user-settable), stop when the change is under
   0.01c. Outputs: policy (argmax per state), V(current state), the next step. src/solver/rollout.ts:
   simulate the policy 20,000 times from the current state using the cached tables: mean, median,
   p90, worst, P(finished within budget B). Alternative targets are extra terminal states with a
   sell value. State budget: cap picks at 4, merge "k of n" picks, refuse with a clear message
   above 150,000 states. Package engine + solver for a Web Worker (a single solve(request) entry
   point, no DOM). Milestone 5 tests: essence-only target → M − V(fresh) ≈ essence price ÷ p;
   the policy prefers the cheaper of essence vs chaos when prices flip; sells when an alternative
   target is hit and its value beats continuing; rollout mean matches V within noise; a
   3-pick body armour solve finishes under 3 s in Node.

4. `npm test`, `npm run typecheck`, `npm run build`. STATUS.md: milestones 4 and 5 with the
   numbers, every VERIFY hit, the verification that ran. Commit, push,
   `gh pr create --fill --base main`. Stop. Do not start the UI.
```

**Step D — milestone 6 (UI on Pages).** Ultracode off. Prompt from Cowork after Step C. This is the "usable" line: paste item → target → next step, cost, odds.

You never run commands yourself. Every step ends with a PR; the "merge it and tag it" prompt above (change the PR number) is how each one gets merged. Merging deploys to `https://cameronsinclairplp-del.github.io/poe1-craft-advisor/`.

## Done on 05/09/2026 (for the record)

Parts 1–3 (folder, brief, POC, M1–2 build, GitHub, fix-ups). Guard v1 tested and found wanting; guard v2 blocks `git switch main` outright and hook-file edits; proven in a fresh session. Repo-local git identity set. PR #1 CI green, ruleset `protect-main` active, Pages enabled.

## Ultracode: when to have it on

Ultracode = `xhigh` effort plus Claude Code orchestrating multi-agent workflows for every substantive task. That is what spawned the eight reviewer agents and turned milestones 1–2 into an hours-long run. `CLAUDE.md` cannot switch it off; only you can, per session.

- **Off** for Part 2, Part 3 and milestone 3 (parser). Mechanical work; one pass is enough. In the session, type `/effort high` before pasting the prompt (or move the effort slider in the model picker to `high`).
- **On** for milestones 4 and 5 (actions + abstract state, solver). Adversarial verification earns its cost there.
- If a session still spawns workflows after `/effort high`, ultracode is set persistently: open `%USERPROFILE%\.claude\settings.json` and remove `"ultracode": true`, then turn it on per session from the model picker when you want it.

## What the safety net is

Two layers. Either alone is not enough.

1. **On your machine (Claude Code):** `.claude/settings.json` installs two hooks; the docs confirm hooks fire the same way in the desktop app as in the terminal. `guard.mjs` runs before every shell command and every file edit Claude Code issues and blocks the ones that make mistakes unrecoverable (force push, `reset --hard`, `checkout --`/`restore` on the worktree, `git clean`, `stash drop`, `branch -D`, amend, recursive `rm`, touching `.git`, deleting on GitHub), blocks switching to `main` at all (so nothing can be committed there, even in a one-line `switch && commit`), and blocks edits to the hook files themselves. `autosave.mjs` runs every time Claude Code finishes a turn on a branch: commits whatever is uncommitted as `autosave <time>` and pushes it, and prints `AUTOSAVE FAILED` if it cannot. v2 was tested against 44 commands and file edits. Known limit: the guard fails open if its file is missing from the worktree (only on commits older than the safety-hooks commit) or if `node` is not on PATH.
2. **On GitHub:** a ruleset on `main` (`.github/ruleset-main.json`) refuses force pushes and deletions, and only lets `main` change through a pull request whose `typecheck-and-test` CI check is green. It binds everyone, you and any GitHub Actions token included. Squash merge keeps `main` readable despite the autosave commits on branches.

Net effect: everything Claude Code does is on GitHub within a turn; `main` is always a tested, known-good state; every milestone gets a tag you can return to. Not covered: your own terminal (the hooks only bind Claude Code), and a secret committed to a public repo (rotate it; history is public). There are no secrets in this project.

## Archive — Parts 1–4 (completed 05/09/2026)

Part 1 folder + brief + POC. Part 2 GitHub setup (repo, ruleset, Pages, PR #1). Part 3 fix-ups (deploy-time prices, level-independent tiers, Royale bases out). Part 4 superseded by "The finish line" above. The prompts that were used are in this file's git history if ever needed.
