# poc — proof of concept

Zero-dependency Node script (Node 18+) that proves the PoE 1 pipeline end to end:
RePoE-fork data → per-base mod pool with tiers → weighted roll engine → Monte Carlo odds → live poe.ninja prices → cost per method.

```
node engine.mjs                                                          # demo: Astral Plate ilvl 86, 3 methods
node engine.mjs --scenarios ../test/parity/scenarios.json --out results.json   # the 10 parity scenarios (~4 min)
node engine.mjs --base "Astral Plate" --ilvl 86 --league Allflame --sims 200000
```

First run downloads ~45 MB of game data into `./cache/` (re-used for 7 days) and a price snapshot (re-used for 30 min).

`results.json` in this folder is the scenario run from 05/09/2026 (Allflame, Divine = 452.3c). Two scenarios were cross-checked against an independent Python implementation of the same rules and agreed within Monte Carlo noise.

Assumptions still to verify are marked `// VERIFY` in the source and listed in `../BRIEF.md` §9.
