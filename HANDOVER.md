# Handover to Claude Code

Written 05/09/2026. This folder is ready to open in Claude Code. Nothing has been scaffolded yet on purpose; Claude Code does that as milestone 1.

## What is in the folder

| File | What it is |
|---|---|
| `BRIEF.md` | The spec. Method, data sources, scope, architecture, milestones, risks, VERIFY list. |
| `CLAUDE.md` | Standing instructions Claude Code reads automatically every session. |
| `poc/engine.mjs` | Working proof of concept (Node, no dependencies). Downloads game data + prices, rolls items, prints odds and cost. |
| `poc/results.json` | The POC's numbers for the 10 parity scenarios (run 05/09/2026, Allflame prices). |
| `poc/README.md` | How to run the POC. |
| `test/parity/scenarios.json` | The 10 parity scenarios. `coe_p` is blank until we read the numbers off Craft of Exile. |
| `.gitignore` | node_modules, dist, poc/cache. |

## Steps

1. Open a terminal in `C:\Projects\poe1-craft-advisor`.
2. `git init` then `git add -A` and `git commit -m "Brief, POC and parity scenarios"`. (Skip if you prefer Claude Code to do it.)
3. Run `claude` in that folder.
4. Paste the prompt below as the first message.
5. When it hands back with `STATUS.md` written, come back to Cowork and say **"parity numbers"**. I will read the 10 scenarios off Craft of Exile and give you the `coe_p` values to paste into `test/parity/scenarios.json`.

## First prompt for Claude Code

```
Read CLAUDE.md, then BRIEF.md in full. We are building milestones 1 and 2 of BRIEF.md §7 only.

1. Scaffold the repo layout in BRIEF.md §6: Vite + TypeScript (strict) + Preact + Vitest, tsx for
   scripts, a GitHub Pages deploy workflow. package.json scripts as listed in CLAUDE.md.
2. Write scripts/build-data.ts: download the RePoE fork files listed in BRIEF.md §4, build
   per-item-class pool files (mods with id, name, text, side, group, type, required_level,
   spawn/generation weights by tag, adds_tags, stats min/max, essence-only flag; tiers per base
   tag-set; essences; bench options; fossils). Gzip to public/data/. Print the Astral Plate ilvl 86
   check from §7.1 (109 rollable mods; life T1 175-189 at L86, T2 160-174 at L81; fire res T1
   46-48% at L84) and fail if it does not match.
3. Write scripts/snapshot-prices.ts for the documented poe.ninja endpoints in CLAUDE.md, writing
   public/prices/Allflame.json with chaos-per-unit for Currency, Essence, Fossil, Resonator plus
   BaseType prices, with a timestamp. Descriptive User-Agent.
4. Port poc/engine.mjs to src/engine/pool.ts and src/engine/roll.ts with identical behaviour and
   a seedable RNG. Keep every // VERIFY comment.
5. Write the parity test around test/parity/scenarios.json (do not change the scenarios).
   Stage 1: the TS engine reproduces poc/results.json poc_p within 2x the stated 95% CI.
   Stage 2: when coe_p is filled in, match within 5% relative; until then report PENDING.
6. Write STATUS.md: what passed with the numbers, every VERIFY item you hit, what is next.

Do not start the solver or the UI. Stop after STATUS.md and wait for review.
```

## After milestone 2

Milestones 3 to 6 (parser, actions + abstract state, solver, UI) each get their own prompt after review. Do not let Claude Code run ahead into the solver; it will want to.
