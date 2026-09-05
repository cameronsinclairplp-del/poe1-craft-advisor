# Handover — the one place to look

Updated 05/09/2026 after Claude Code finished milestones 1 and 2 (see `STATUS.md`). Written for Claude Code inside the Claude desktop app (Fable 5.1). You paste prompts; it runs the commands.

## Where things are

| | |
|---|---|
| Done | Foundation: data build, engine, parity harness, prices, GitHub, CI, ruleset, Pages, safety hooks proven (05/09/2026). |
| Now | Build the product. Four Claude Code runs left: M3 parser → M4 actions → M5 solver → M6 UI. Parity numbers from Cowork run in parallel. |
| Finished means | You paste an item, pick a target, get the next step, cost and odds, on the Pages site. |

## The finish line, step by step

**Step A — merge the foundation and start milestone 3 (now, current session, `/effort high`).** Paste:

```
Read CLAUDE.md, STATUS.md, then BRIEF.md §3, §6 and §7. Do this in order.

1. `gh pr merge 1 --squash --auto`, then poll `gh pr view 1 --json state,mergeCommit` until
   state is MERGED. Report the merge commit. Then `git fetch origin` and
   `git switch -c m3-parser origin/main`. (If gh moved you onto main, that switch fixes it.)

2. Milestone 3, the item parser. src/parse/itemText.ts:
   - Input: PoE 1 advanced item text (Ctrl+Alt+C in game). Output: Item { base resolved to a
     RePoE base id via index.json (disambiguate by item class), itemClass, ilvl, rarity
     normal|magic|rare|unique, influences, corrupted, mirrored, mods[] } where each explicit mod
     is { side, name, tier from "(Tier: n)", text, modId, flags crafted|fractured|veiled|
     unveiled } plus implicits/enchants/eldritch implicits kept separately, openPrefixes,
     openSuffixes, metamods present.
   - Resolve modId by mod name + side + item-class ladder from the class file. Cross-check the
     in-game "(Tier: n)" against our level-independent tier and FAIL LOUDLY on mismatch (that
     mismatch is exactly what VERIFY 8 needs to surface). Unknown names → ParseError naming the
     line; never guess. Influence-only mods (VERIFY 9) → recorded as unresolved-influence, not
     an error.
   - Fixtures in test/fixtures/items/*.txt, at least 12. Use real pastes from public sources
     (Path of Building GitHub issues and forum threads contain exact Ctrl+Alt+C dumps); note the
     source URL in a comment line at the top of each fixture. Cover: rare with a crafted mod;
     rare with "Prefixes Cannot Be Changed"; fractured; magic with 1 mod and with 2; normal;
     Shaper or Hunter influenced; corrupted with implicit; a unique (rarity only, no mod
     resolution); a jewel and a flask → explicit UnsupportedItemClass error. Cameron will add
     three of his own items later; make it trivial to drop a file in.
   - Tests: every fixture parses; the tier cross-check passes on every resolved mod; unknown-name
     and unsupported-class error paths tested.

3. While you are in scripts/build-data.ts: stamp the class files with RePoE's Last-Modified
   header, not run time, so a re-run with unchanged data dirties nothing.

4. `npm test`, `npm run typecheck`, `npm run build`. STATUS.md: milestone 3 section with the
   numbers, VERIFY items hit, how much verification ran. Commit, push,
   `gh pr create --fill --base main`. Stop. Do not start milestone 4.
```

**Step B — parity numbers (Cowork, in parallel with Step A).** Say **"parity numbers"** to Cowork. When you have the ten values, in Claude Code (any session, any branch except main):

```
`git fetch origin && git switch -c parity-numbers origin/main`. Fill ONLY the coe_p fields in
test/parity/scenarios.json with these values, changing nothing else: <the ten lines>.
`npm test` and show me the parity summary table. Commit "Parity stage 2: Craft of Exile numbers",
push, `gh pr create --fill --base main`. Stop. Do not change engine code even if scenarios fail.
```

All ten pass → merge it, then `git fetch origin && git tag -a m2-parity origin/main -m "Engine matches Craft of Exile" && git push origin --tags`. Any fail → paste the table to Cowork; the suspects are STATUS.md VERIFY 1–4 in that order.

**Step C — milestone 4 + 5 (actions, abstract state, solver).** Ultracode ON for this one. Cowork writes the prompt once Step A's PR is merged; it depends on what the parser produced.

**Step D — milestone 6 (UI on Pages).** Ultracode off. Prompt from Cowork after Step C. This is the "usable" line: paste item → target → next step, cost, odds.

Each step ends with a PR you merge (`gh pr merge <n> --squash --auto` in Claude Code, or the green button on GitHub). Merging deploys to `https://cameronsinclairplp-del.github.io/poe1-craft-advisor/`.

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

## Part 2 — GitHub setup (paste into Claude Code, effort high)

The device-code step needs you: Claude Code will print a code, you type it at github.com/login/device. Everything else is hands-off.

```
Read CLAUDE.md. Do exactly these steps in order, report each result, and stop after step 10.
Ask me before doing anything not listed here.

1. Run `node safety/install.mjs`. It moves the hooks, CI workflow and ruleset file into
   .claude/ and .github/ and removes safety/. Confirm the five files exist.
2. `git branch -M main`, then `git switch -c m1-m2-foundation`, then `git add -A`, then
   commit with message "Milestones 1-2: scaffold, data build, price snapshot, engine port,
   parity test, safety hooks, CI".
3. Check `gh --version`. If gh is missing, install it:
   `winget install --id GitHub.cli --source winget --accept-source-agreements --accept-package-agreements`
   then use the full path "C:\Program Files\GitHub CLI\gh.exe" for every gh command in this
   session (PATH only updates for new processes).
4. `gh auth status`. If not logged in, run
   `gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key --scopes workflow`
   with a 10-minute timeout. It prints a one-time code and https://github.com/login/device.
   Tell me the code straight away and keep the command running while I enter it in my browser.
   When it finishes: `gh auth setup-git --hostname github.com`, then `gh auth status`.
5. `gh repo create poe1-craft-advisor --public --source=. --remote=origin` (no --push).
6. `git push -u origin main` FIRST so main becomes the default branch, then
   `git push -u origin m1-m2-foundation`.
7. `gh repo edit --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge --enable-auto-merge`
8. `gh api -X POST repos/cameronsinclairplp-del/poe1-craft-advisor/rulesets --input .github/ruleset-main.json`
9. `gh api -X POST repos/cameronsinclairplp-del/poe1-craft-advisor/pages -f build_type=workflow`
   (a 409 means Pages already exists: retry with -X PUT).
10. `gh pr create --fill --base main`. Print the PR URL. Do not merge. Stop.
```

Notes:
- `--scopes workflow` matters: without it GitHub refuses pushes that contain `.github/workflows`.
- Public because GitHub Pages on a free account needs it (same as `la-trade-links`). Site: `https://cameronsinclairplp-del.github.io/poe1-craft-advisor/` once `main` has the app.
- If step 8 or 9 errors, do it in the browser: Settings → Rules → Rulesets → New branch ruleset (import `.github/ruleset-main.json`); Settings → Pages → Source: GitHub Actions.
- After this, start a new Claude Code session so the hooks are definitely loaded. Quick test: ask it to run `git switch main && git commit --allow-empty -m test`. The guard must block it.

## Part 3 — fix-up prompt for Claude Code (new session, effort high)

```
Read CLAUDE.md, STATUS.md, then BRIEF.md. You are on branch m1-m2-foundation with an open PR.
Three changes, then update STATUS.md, commit, push. Do not start milestone 3.

1. Prices: stop committing snapshots from CI. Delete .github/workflows/snapshot-prices.yml. In
   deploy.yml add a schedule trigger (cron "17 */6 * * *") and run
   `npm run snapshot-prices -- --league Allflame --force` as a build step before `npm run build`,
   with the ETag cache step kept, so every deploy (push, cron, manual) ships fresh prices without a
   commit. Remove the workflow_run trigger and its comment. public/prices/Allflame.json stays in
   git as the dev/offline fallback. Reason: the main branch ruleset blocks pushes from GITHUB_TOKEN,
   and four bot commits a day add nothing; poe.ninja already keeps price history.

2. Tiers: make tier numbers independent of item level, as CLAUDE.md Conventions now says. Rank
   each (group, side) ladder over every mod that can roll on the base's tag set at any level
   (build the ladder at ilvl 100); the pool at a given ilvl is the subset that can roll. This is
   what the in-game "(Tier: n)" and Craft of Exile show, and the milestone 3 parser depends on
   it. Re-run the full test suite. If any parity hit count changes, report which scenario and
   which mod above ilvl 86 caused it. Update STATUS.md VERIFY 8 accordingly.

3. index.json: drop Royale bases (tag not_for_sale). Leave everything else as is.

Then: `npm test`, `npm run typecheck`, `npm run build`, update STATUS.md (a short "fix-up" section
plus the changed VERIFY items), commit with a clear message, push. Stop.
```

## Part 4 — superseded by the walkthrough at the top

Parts 2 and 3 are done (05/09/2026). Follow "Walkthrough from here" above.

## Part 1 — done 05/09/2026

Folder created, brief and POC written, Claude Code built milestones 1–2 (`STATUS.md`).
