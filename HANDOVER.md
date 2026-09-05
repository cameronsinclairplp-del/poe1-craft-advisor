# Handover — the one place to look

Updated 05/09/2026 after Claude Code finished milestones 1 and 2 (see `STATUS.md`). Written for Claude Code inside the Claude desktop app (Fable 5.1). You paste prompts; it runs the commands.

## Where things are

| | |
|---|---|
| Done | Parts 1–3. Repo is on GitHub, PR #1 open (`m1-m2-foundation` → `main`, 2 commits), CI ran on it. Hooks installed on disk. |
| Now | The walkthrough below, top to bottom. One step at a time. |
| Then | Milestone 3 (parser) prompt from Cowork, after parity passes. |

## Walkthrough from here (05/09/2026)

**Step 1a — guard v2 in, identity fixed, checks 2 and 3 (current session, effort high).** The first guard test (05/09/2026) found two holes: `git switch main && git commit` slipped past because the guard only looked at the branch before the line ran, and the shell had no git identity so every commit (autosave included) failed silently. Both are fixed in `safety\`. Paste:

```
Six steps, in order, then stop.
1. `node safety/install.mjs` — installs guard v2, autosave v2 and the updated settings.
2. Git identity, repo-local so it does not depend on which shell runs: `gh api user --jq .id`
   to get my GitHub id, then `git config user.name "Cameron"` and
   `git config user.email "<id>+cameronsinclairplp-del@users.noreply.github.com"`.
   Print `git config user.email` to confirm.
3. `git add -A`, commit "Safety hooks v2: block switching to main, autosave reports failures,
   protect hook files", push.
4. `gh pr checks 1` — report each check and its conclusion.
5. `gh api repos/cameronsinclairplp-del/poe1-craft-advisor/rulesets` — report whether
   protect-main exists.
6. `gh api repos/cameronsinclairplp-del/poe1-craft-advisor/pages` — report whether Pages is
   enabled with build_type "workflow" (a 404 means not enabled: say so, do not fix it).
```

**Step 1b — prove the guard (new session).** Close that session, start a new one in the folder (hooks load at session start), `/effort high`, paste:

```
Two probes, then stop. Both must be BLOCKED by .claude/hooks/guard.mjs.
1. `git switch main && git commit --allow-empty -m test`
2. `git switch main`
If either one runs instead of being blocked, stop immediately and tell me. Then `git status`
and confirm we are on m1-m2-foundation with a clean tree.
```

Pass = both blocked, `typecheck-and-test` passing, ruleset present, Pages enabled. Anything else: paste the output to Cowork before going on.

**Step 2 — parity numbers.** Say **"parity numbers"** to Cowork. It reads the ten scenarios off Craft of Exile and hands you ten `coe_p` values.

**Step 3 — fill them in and test.** Same Claude Code session:

```
Fill ONLY the coe_p fields in test/parity/scenarios.json with these values, in this order,
changing nothing else in the file: <paste the ten id: value lines Cowork gave you>.
Run `npm test` and show me the parity summary table. Commit "Parity stage 2: Craft of Exile
numbers" and push. Stop. Do not change any engine code even if scenarios fail.
```

**Step 4a — all ten pass:** merge and tag.

```
`gh pr merge 1 --squash --delete-branch --auto`, wait for it to merge, then `git fetch origin`,
then `git tag -a m2-parity origin/main -m "Engine matches Craft of Exile"` and
`git push origin --tags`. Do not switch to main (the guard blocks it; tagging origin/main
does not need it). Report the merge commit and the tag. Stop.
```

Then ask Cowork for the milestone 3 prompt.

**Step 4b — any scenario fails:** do not merge. Paste the parity table to Cowork. The suspects are `STATUS.md` VERIFY 1–4, in that order, and Cowork will write the fix prompt.

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
