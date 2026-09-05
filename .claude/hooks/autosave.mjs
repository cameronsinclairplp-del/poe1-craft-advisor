// Claude Code Stop hook: every time Claude finishes a turn on a branch, commit whatever is
// uncommitted and push it. Nothing Claude did can then be lost to a crash, a bad command or a
// dead disk. Never runs on main (the guard hook keeps work off main anyway).
//
// The branch history gets noisy ("autosave ..." commits); PRs are squash-merged so main stays clean.

import { execSync } from "node:child_process";

const run = (command) => execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

try {
  run("git rev-parse --is-inside-work-tree");
  const branch = run("git rev-parse --abbrev-ref HEAD");
  if (branch === "main" || branch === "master" || branch === "HEAD") process.exit(0);

  run("git add -A");
  let staged = true;
  try {
    run("git diff --cached --quiet");
    staged = false; // exit 0 = nothing staged
  } catch {
    staged = true; // exit 1 = there are staged changes
  }
  if (!staged) process.exit(0);

  const stamp = new Date().toLocaleString("en-AU", { hour12: false, timeZone: "Australia/Perth" });
  run(`git commit -q -m "autosave ${stamp}"`);

  try {
    run("git remote get-url origin");
    run(`git push -q -u origin ${branch}`);
  } catch {
    // no remote yet, offline, or rejected: the local commit still exists
  }
} catch {
  // not a git repo, or git missing: nothing to do
}
process.exit(0);
