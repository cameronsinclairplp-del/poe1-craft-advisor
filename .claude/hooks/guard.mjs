// Claude Code PreToolUse hook for Bash.
// Blocks the commands that turn a mistake into an unrecoverable one. Exit 2 = block, the
// message on stderr goes back to Claude so it can do the safe thing instead.
//
// Belt and braces: this hook is the belt (it runs on Claude Code's side, before the command),
// the GitHub ruleset on main is the braces (the server refuses force pushes and deletions
// whatever the client does).
//
// v2 (05/09/2026): switching to main/master is blocked outright. Claude never needs to be on
// main — branch from origin/main, tag origin/main, merge through PRs. This also closes the
// compound-command gap ("git switch main && git commit ...") that v1 let through, because v1
// only looked at the branch before the command ran.

import { execSync } from "node:child_process";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

// File-editing tools (Write / Edit / MultiEdit / NotebookEdit): only the safety files are off limits.
if (input?.tool_name && input.tool_name !== "Bash") {
  const target = String(input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? "").replace(/\\/g, "/");
  if (/\.claude\/(?:settings\.json|hooks(?:\/|$))/.test(target)) {
    process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: editing ${target}. The safety hooks and their settings are Cameron's call.\n`);
    process.exit(2);
  }
  process.exit(0);
}

const cmd = input?.tool_input?.command ?? "";
if (!cmd) process.exit(0);

const c = cmd.replace(/\s+/g, " ").trim();

const rules = [
  [/\bgit(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+(?:switch|checkout)\b(?:\s+-\S+)*\s+(?:main|master)\b(?![\w./-])/, "switching to main. Claude never works on main. Branch from it instead: `git fetch origin && git switch -c <name> origin/main`. Tag it without switching: `git tag -a <tag> origin/main -m \"...\"`."],
  [/\bgit(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+(?:switch|checkout)\s+-(?:\s|$)/, "`git switch -` goes back to the previous branch, which may be main. Name the branch."],
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
  [/\bgit config\b.*\bcore\.hooksPath\b/, "changing where git looks for hooks. Ask Cameron."],
  [/(?=.*\.claude[\/\\](?:settings\.json|hooks))(?=.*(?:>|\bsed -i\b|\bperl -i\b|\bmv\b|\bcp\b|\brm\b|\bdel\b|\btee\b|\bchmod\b|\bgit (?:rm|mv)\b|\bSet-Content\b|\bOut-File\b|\bAdd-Content\b|\bMove-Item\b|\bCopy-Item\b|\bRemove-Item\b|\bRename-Item\b))/i, "writing to the safety hooks or their settings. Reading them is fine; changing them is Cameron's call."],
];

for (const [re, why] of rules) {
  if (re.test(c)) block(why);
}

// Commits and pushes happen on branches, never on main. Main changes through squash-merged PRs.
// (Defence in depth: the switch-to-main rule above already keeps Claude off main.)
if (/\bgit (?:commit|push)\b/.test(c) && !/\bgit push\b.*--tags/.test(c)) {
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    branch = "";
  }
  if (branch === "main" || branch === "master") {
    block(`you are on ${branch}. Create a branch first: git fetch origin && git switch -c <milestone-or-task-name> origin/main. Main only changes through pull requests.`);
  }
}

process.exit(0);

function block(why) {
  process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: ${why}\nCommand was: ${c}\n`);
  process.exit(2);
}
