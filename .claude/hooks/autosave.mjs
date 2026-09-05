// Claude Code Stop hook: every time Claude finishes a turn on a branch, commit whatever is
// uncommitted and push it. Nothing Claude did can then be lost to a crash, a bad command or a
// dead disk. Never runs on main (the guard hook keeps work off main anyway).
//
// The branch history gets noisy ("autosave ..." commits); PRs are squash-merged so main stays clean.
//
// v2 (05/09/2026): failures are no longer silent. A missing git identity or a failed commit
// prints AUTOSAVE FAILED to stderr and exits 1 (non-blocking, shown in the transcript).

import { execSync } from "node:child_process";

const run = (command) => execSync(command, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const fail = (msg) => {
  process.stderr.write(`AUTOSAVE FAILED (.claude/hooks/autosave.mjs): ${msg}\n`);
  process.exit(1);
};

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let branch = "";
try {
  run("git rev-parse --is-inside-work-tree");
  branch = run("git rev-parse --abbrev-ref HEAD");
} catch {
  process.exit(0); // not a git repo, or git missing: nothing to do
}
if (branch === "main" || branch === "master" || branch === "HEAD") process.exit(0);

try {
  run("git add -A");
} catch (e) {
  fail(`git add failed: ${String(e.stderr ?? e.message).trim()}`);
}

let staged = true;
try {
  run("git diff --cached --quiet");
  staged = false; // exit 0 = nothing staged
} catch {
  staged = true; // exit 1 = there are staged changes
}
if (!staged) process.exit(0);

let email = "";
try { email = run("git config user.email"); } catch { email = ""; }
if (!email) {
  fail("no git identity in this repo. Uncommitted work is staged but NOT committed. Fix once: git config user.name \"Cameron\" && git config user.email \"<id>+cameronsinclairplp-del@users.noreply.github.com\"");
}

const stamp = new Date().toLocaleString("en-AU", { hour12: false, timeZone: "Australia/Perth" });
try {
  run(`git commit -q -m "autosave ${stamp}"`);
} catch (e) {
  fail(`commit failed: ${String(e.stderr ?? e.message).trim()}`);
}

try {
  run("git remote get-url origin");
} catch {
  process.stderr.write("autosave: committed locally; no origin remote to push to\n");
  process.exit(0);
}
try {
  run(`git push -q -u origin ${branch}`);
} catch (e) {
  process.stderr.write(`autosave: committed locally but push failed: ${String(e.stderr ?? e.message).trim().split("\n").slice(-1)[0]}\n`);
}
process.exit(0);
