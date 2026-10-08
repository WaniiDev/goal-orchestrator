# Implementer brief template

Copy this into `BRIEF.md` in the scratchpad and fill every `<…>` from recon. Keep it under about 80 lines: implementers read it first, every time.

```markdown
# Implementer brief: <goal>

You are one implementer in a multi-agent build of <goal>. The orchestrator gives you one lane, merges your branch into `<feature-branch>`, and has every wave reviewed.
<AWAY: The user is away: never ask questions, never wait. Decide every open point yourself in this order: issue text > plan doc > design reference > repo docs/ADRs > smallest safe option, and list each decision in your report.>
<AROUND: If a decision changes what gets built (scope, architecture, data model), stop and report the question instead of guessing; decide small points yourself and list them.>

## Workspace
- Work ONLY in your worktree: <path given in your task>. It is already on the latest `<feature-branch>`. Do not reset it, and do not touch the main checkout or other worktrees. Begin each Bash command with `cd <worktree>`.
- First: `<install command, e.g. cd app && bun install --frozen-lockfile>`.
- Your own database: `<db name in your task>` (ends in `_test`). Set `<DATABASE_URL vars>` explicitly; prepare it with `<command>`. Never touch any other database.
- Your own port: `<E2E_PORT in your task>`. <browser notes, e.g. Chromium at /opt/pw-browsers; never run `playwright install`; local config file to copy and never commit>.
- Never kill a process you did not start; kill only PIDs you launched (never `pkill -f <pattern>`).
- No Docker/Podman unless the repo requires it.

## Read first
<steering files and the specific docs for this goal: product, design, architecture, testing, ADRs, design reference folder>

## Invariants (must hold in your diff)
<the repo's rules, e.g. auth → authorize → validate → DB; schema and its verification aligned; API allowlist; realtime publish inside the write's transaction; base-path helpers; UI only from the design system and tokens; all locale files together with real translations; file and function size caps; naming>
- Never skip, disable or weaken a test. Never weaken a guard.

## Method
1. Test first: a failing test, then the change, then refactor.
2. Focused runs: `<fast unit command for paths>`; never set feature flags meant for e2e when running unit tests.
3. Before you finish: `<typecheck>`, `<typecheck tests>`, `<lint>`, `<unused-code check>`, the focused tests, and the e2e filter named in your task. Do not hide exit codes behind `| tail`; read the summary line.
4. Update the owning docs when behaviour changes (<doc map>).
5. Commit on your worktree branch (do not push, no PRs, no tracker writes). Message: `<imperative summary> (<ISSUE>)`, a blank line, then exactly:
   <attribution trailers for this session>
   Leave the worktree clean.

## Report (your final message, as text: you cannot write report files)
- Worktree, branch, commit SHA(s).
- Files changed, one line each.
- Each Done-when item: met / not met, with the test or screenshot that proves it.
- Every check you ran: exact command, pass/fail with counts.
- Decisions you made, and anything you could not finish and why.
```
