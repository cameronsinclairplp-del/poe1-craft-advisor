// Claude Code PreToolUse hook for Bash.
// Blocks the commands that turn a mistake into an unrecoverable one. Exit 2 = block, the
// message on stderr goes back to Claude so it can do the safe thing instead.
//
// Belt and braces: this hook is the belt (it runs on Claude Code's side, before the command),
// the GitHub ruleset on main is the braces (the server refuses force pushes and deletions
// whatever the client does).

import { execSync } from "node:child_process";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let cmd = "";
try {
  cmd = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}
if (!cmd) process.exit(0);

const c = cmd.replace(/\s+/g, " ").trim();

const rules = [
  [/\bgit push\b.*(?:\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, "force push rewrites history that may already be on GitHub. Make a new commit instead."],
  [/\bgit push\b.*(?:--delete\b|\s:\S)/, "deleting a remote branch. Leave it; branches are cheap."],
  [/\bgit reset --hard\b/, "git reset --hard discards uncommitted work. Use `git stash` (keeps it) or commit first."],
  [/\bgit checkout\b.*(?:\s--\s|\s\.(?:\s|$))/, "git checkout -- <path> / git checkout . discards uncommitted changes. Use `git stash` instead."],
  [/\bgit restore\b(?!.*--staged)/, "git restore discards uncommitted changes. Use `git stash` instead (git restore --staged is fine)."],
  [/\bgit clean\b/, "git clean deletes untracked files for good. Add them to .gitignore or commit them."],
  [/\bgit stash (?:drop|clear)\b/, "dropping a stash is unrecoverable. Leave it."],
  [/\bgit branch\b.*(?:\s-D\b|\s-[a-zA-Z]*[Dd][a-zA-Z]*f|\s-f[a-zA-Z]*[Dd]|--delete --force)/, "force-deleting a branch loses unmerged commits. Use -d, which refuses if unmerged."],
  [/\bgit commit\b.*--amend/, "amend rewrites the last commit. Make a new commit."],
  [/\bgit (?:filter-branch|filter-repo|replace)\b|\bgit reflog (?:expire|delete)\b|\bgit gc\b.*--prune|\bgit update-ref -d\b/, "history surgery. Not in this repo."],
  [/(?:^|[\s;&|(`])rm\s+(?:-[a-zA-Z]*[rR]|--recursive)/, "recursive rm. Move files with `git mv`, delete with `git rm <file>` and commit, or ask Cameron."],
  [/\brm\b.*\.git(?:\/|\\|\s|$)/, "touching .git directly. Ask Cameron."],
  [/\b(?:rmdir|rd)\b.*\/[sS]\b|\bRemove-Item\b.*-Recurse|\bdel\b.*\/[sS]\b/i, "recursive delete. Use git rm and commit, or ask Cameron."],
  [/\bgh repo delete\b|\bgh api\b.*-X\s*DELETE/i, "deleting things on GitHub. Ask Cameron."],
];

for (const [re, why] of rules) {
  if (re.test(c)) block(why);
}

// Commits and pushes happen on branches, never on main. Main changes through squash-merged PRs.
if (/\bgit (?:commit|push)\b/.test(c) && !/\bgit push\b.*--tags/.test(c)) {
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    branch = "";
  }
  if (branch === "main" || branch === "master") {
    block(`you are on ${branch}. Create a branch first: git switch -c <milestone-or-task-name>. Main only changes through pull requests.`);
  }
}

process.exit(0);

function block(why) {
  process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: ${why}\nCommand was: ${c}\n`);
  process.exit(2);
}
