# poe1-craft-advisor — instructions for Claude Code

A "what do I do next" crafting advisor for Path of Exile 1 (patch 3.29, Allflame league). Paste an item, describe the target, get the optimal next action, expected cost or profit, and the odds. Static site, all maths in the browser.

**Read `BRIEF.md` in full before doing anything.** It is the spec: method (§3), data sources (§4), scope (§5), architecture (§6), milestones with pass/fail checks (§7), risks (§8), the VERIFY list (§9). `STATUS.md` is the current state of the build; read it second.

## Ground rules

1. **Milestones in order.** §7 of the brief. Do not touch the solver or the UI until milestone 2 (parity) passes. Nothing downstream is trustworthy until the roll engine matches Craft of Exile.
2. **Never invent game mechanics or numbers.** If the RePoE data or the brief does not state it, mark it `// VERIFY` in code and list it in `STATUS.md`. Do not guess mod weights, affix-count splits, essence rules or bench behaviour.
3. **`poc/` is reference, not code to extend.** `poc/engine.mjs` is the proof of concept the TS engine must reproduce. Leave it as is. `poc/results.json` holds its numbers for the parity scenarios.
4. **`test/parity/scenarios.json` is fixed.** Build the test around it; do not edit the scenarios. `coe_p` values are filled in by Cameron from Craft of Exile; treat `null` as PENDING, not as a failure.
5. **Data is generated, then committed.** `scripts/build-data.ts` pulls the RePoE fork and writes `public/data/`. `scripts/snapshot-prices.ts` pulls poe.ninja and writes `public/prices/`. The browser never calls poe.ninja directly (CORS, and their API rules say proxy or snapshot).
6. **poe.ninja etiquette.** Descriptive `User-Agent`, respect `Cache-Control`/ETag, never poll faster than every 30 minutes. Documented endpoints only (`/poe1/api/economy/...`). The old `/api/data/...` endpoints are dead.
7. **Small, checked steps.** After each milestone, update `STATUS.md`: what passed (with the numbers), what is VERIFY, what is next. Then open the PR and stop.
8. **Verification effort matches the change.** Fix-ups, data scripts, the parser: one focused check (run the tests, run the script, read the diff). The roll engine, actions and solver: adversarial verification is worth it. If ultracode is on, one verification workflow per milestone, not eight reviewer agents per change; the first hand-back cost hours that way. Say in `STATUS.md` how much verification ran.

## Git discipline (the safety net)

- **Never work on main.** First thing every session: `git status`, then `git switch -c <milestone-or-task>` if you are on main. Commits and pushes on main are blocked by the guard hook; main only changes through squash-merged pull requests.
- **Commit after every green `npm test`**, with a message that says what changed and why. Small commits, often.
- **Autosave is on.** A Stop hook commits anything uncommitted as `autosave <time>` and pushes the branch every time you finish a turn. It is a backstop, not a substitute for real commits. Do not disable or edit `.claude/hooks/`.
- **Never rewrite pushed history or discard work.** No force push, no amend, no `reset --hard`, no `checkout --`/`restore` on the worktree, no `git clean`, no `stash drop`, no `branch -D`, no recursive `rm`. `.claude/hooks/guard.mjs` blocks these. If it blocks you, do the safe thing it suggests (stash, new commit, new branch, `git rm` + commit). Do not look for a way around it.
- **Hand-back = pull request.** When a milestone is done: update `STATUS.md`, commit, push, `gh pr create --fill --base main`, and stop. Cameron merges. CI (`typecheck-and-test`) must be green; it is a required check.
- **Tag merged milestones** (Cameron does this): annotated tags like `m2-parity`, `m3-parser`. They are the known-good points to return to.
- **No secrets.** None are needed (poe.ninja is unauthenticated, Pages uses `GITHUB_TOKEN`). If one ever appears, stop and say so. `.env` is ignored.

## Stack

TypeScript (strict), Vite, Preact, Vitest. GitHub Pages via `deploy.yml`. Solver runs in a Web Worker. No backend, no database, no accounts.

Scripts run with `tsx`. Node 22 is installed.

## Conventions

- Australian English in UI copy and docs. Dates DD/MM/YYYY. 24-hour time.
- Chaos Orb is the unit of account; show Divines alongside using the snapshot rate.
- Mod identity is the RePoE mod id; group is `groups[0]`; tiers are 1 = best, ranked within (group, side) over the mods that can roll on that base's tag set at any item level, so the number matches the in-game "(Tier: n)" and Craft of Exile. The pool at a given ilvl is the subset that can roll. Essence-only mods get a value-based tier (see `poc/engine.mjs` `buildPool`). If a better tiering rule is needed, propose it in `STATUS.md` first.
- Targets are tier-based. Roll values inside a tier are out of scope for v1.
- Keep the engine pure and deterministic (seedable RNG) so tests are reproducible.

## Data sources (verified 05/09/2026)

- RePoE fork, PoE 1 files at the root: `https://repoe-fork.github.io/{mods,base_items,essences,fossils,crafting_bench_options,mod_types,tags,item_classes}.json`. CORS `*`. Current for 3.29.
- poe.ninja: `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Allflame&type=Currency|Essence|Fossil|Resonator`, `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Allflame&type=BaseType|Beast`, `https://poe.ninja/poe1/api/economy/leagues`. Docs at `https://poe.ninja/docs/api`.
- Parity reference: Craft of Exile (craftofexile.com, updated for 3.29). No API; numbers are read off by hand.

## Commands

```
npm run build-data       # RePoE -> public/data
npm run snapshot-prices  # poe.ninja -> public/prices/<league>.json
npm test                 # vitest: engine unit tests + parity
npm run typecheck
npm run build
npm run dev              # Vite dev server
```
