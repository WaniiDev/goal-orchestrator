---
name: run
description: Ship a goal (a tracker issue and its sub-issues, a plan doc, or a written goal) as ONE pull request on ONE branch, with implementer and reviewer sub-agents in waves, verified end to end.
argument-hint: "<goal: issue key(s), plan doc path, or a sentence> [--auto]"
disable-model-invocation: true
---

# Goal orchestrator

You plan, brief, merge, verify and deliver. Sub-agents read and build. Keep conclusions in your context, not file contents.

Goal: $ARGUMENTS

Read each reference only at its step: [intake](references/intake.md) (0), [brief template](references/brief-template.md) (2), [review prompts](references/review-brief.md) (4), [delivery](references/delivery.md) (6). Progress format: [status](../status/SKILL.md). Final results: [report](../report/SKILL.md).

**State** lives in the scratchpad (else `.orchestrator/` in the session temp dir): `RUN.md` (choices, plan, gate results), `DECISIONS.md` (one line per decision: what, why, which source), `BRIEF.md`, `reports/`. After a compaction, re-read `RUN.md` first. After a container restart, restart services (for example the DB) and relaunch lost background jobs.

## Step 0: Intake

Follow [intake](references/intake.md).
- **Away**: after intake, never ask or wait. Decide by issue text > plan doc > design reference > repo docs and ADRs > smallest safe option; log each decision. Push after every merge.
- **Around**: ask only about scope, architecture, data model or anything destructive; still log decisions.

## Step 1: Recon (cheap; send wide sweeps to an Explore agent)

1. From the steering files (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, `README`, `TESTING`) and the CI config: app root, package manager, check commands (typecheck, lint, unused code, unit, integration, e2e, schema verification), invariants, doc owners, commit and PR conventions, tracker rules. Use the repo's code-graph index if it has one.
2. The goal: every issue (Done-when, Not in scope, links), any plan doc and design reference. If a written goal has no Done-when items, write them into `RUN.md`.
3. Environment: a test DB (native; no Docker unless the repo requires it), a browser for e2e, network access, and how each agent gets its own DB and port.
4. Create or check out the feature branch (the session's designated branch if given), push it, and run `git config rerere.enabled true`.
5. Run the fast checks once on the base. List any failures in `BRIEF.md` as pre-existing, so agents don't re-prove them.
6. Load the run tools and `SendMessage` with one `ToolSearch` (`select:mcp__goal-orchestrator__run_start,mcp__goal-orchestrator__run_finish,SendMessage`), then call `run_start` (branch, absolute repo path, any budget the user gave).

## Step 2: Plan

- A **lane** is one issue (or a tight group) that one implementer owns end to end, with named files. A **wave** is 3–5 lanes with disjoint files. Order by dependency: schema and server before UI, shared primitives before the screens that use them. Docs-only and test-only lanes ride along.
- Put the waves, lanes, owned files, and DB and port per lane in `RUN.md`. In the session's task list, add one item per wave, plus "Final gate" and "Deliver".
- Write `BRIEF.md` from the [template](references/brief-template.md). It is the distilled repo profile that agents read instead of the steering docs.

## Step 3: Run a wave

For each lane:
1. `git worktree add -b lane-<id> <repo>/.claude/worktrees/lane-<id> <feature-branch>`. Don't use `isolation: "worktree"`: it branches from the default branch. Copy in any untracked local test config the lane needs.
2. Launch `Agent` with `subagent_type: "goal-orchestrator:implementer"`, `name: "lane-<id>"`, and `model` and `effort` from `RUN.md`; it runs in the background. The prompt holds only: the worktree path, the `BRIEF.md` path, the issue(s) and Done-when items, owned files and files to avoid, the DB and port, and the e2e filter. The agent definition carries its rules and report format.
3. While lanes run, prepare the next wave. Don't duplicate their work.

When a lane reports:
- Save the report to `reports/lane-<id>.md` and keep one verdict line in context.
- Spot-check one claim by re-running one command.
- Send gaps back to the same agent (`SendMessage` to `lane-<id>`) with the exact gap. After 2 retries, re-plan or drop the lane (see Stop conditions).
- Merge: `git merge --no-ff lane-<id> -m "Merge <ISSUE>: <summary>"` plus attribution trailers. Resolve conflicts per hunk, keeping both sides' intent.
- Run the fast checks on the merged area. Stage everything you touched (`git status --short` is empty after the commit), then push.

## Step 4: Review the wave

Skip docs-only and test-only waves. Otherwise launch `goal-orchestrator:reviewer` (model and effort from `RUN.md`) in a fresh worktree on the feature head, with the wave prompt from [review prompts](references/review-brief.md). For UI work, also launch one `goal-orchestrator:ui-auditor` per area (lists, dialogs and drawers, motion), each with its own DB and port.

Save the findings to `reports/`. Turn must-fix and should-fix findings into fix lanes grouped by file. For each finding you drop, log the reason in `DECISIONS.md`. Security findings are never dropped: fix them, ask (around), or log them prominently (away). Re-review only the areas a large fix touched.

## Step 5: Final gate

If the base moved, merge it in first; prefer that to rebasing. On the feature head, run everything (background long runs) and record exact results in `RUN.md`:
- typecheck for app and tests, lint, unused code;
- the full unit and integration suites with the real DB;
- schema verification;
- the full e2e suite.

Then run one whole-diff review, plus a visual re-check for UI goals. Fix what it finds, then re-run the gate. A flaky test is root-caused (product bug or test bug; note failures near midnight UTC), and the fix is proven with about 10 repeats plus one full-suite run.

## Step 6: Deliver

Follow [delivery](references/delivery.md):
1. Open the PR (if the finish line includes it).
2. Drive CI to green, then merge if the finish line says so.
3. Update the tracker.
4. Produce the final results with the [report](../report/SKILL.md) skill.
5. Clean up: remove worktrees, and stop watching the PR after the merge.
6. Call `run_finish` last.

## Stop conditions

Every run ends in exactly one terminal state, through `run_finish`:
- `DONE`: every issue shipped and verified at the chosen finish line.
- `PARTIAL`: some issues shipped. A draft PR (or the pushed branch) lists what didn't ship and why.
- `BLOCKED`: only the user can unblock it (auth, a secret or service, a refused permission, a merge that needs approval or is blocked by branch protection), or the run can't progress.

Finish as `BLOCKED` or `PARTIAL` instead of retrying when:
- the same check fails the same way twice after a fix;
- a lane fails 2 retries (re-plan it once, then drop it → `PARTIAL`);
- the watchdog says to wrap up.

Before `run_finish`, in order: push, update `RUN.md`, `DECISIONS.md` and the PR or draft PR, remove the worktrees. After `run_finish`, make no more tool calls (the app's own end-of-turn wrap-up excepted), and end the reply with the `GOAL: …` line it returns. In away mode a block is not a question: finish, and the user reads the line when they're back.

The plugin's mod enforces this:
- **Progress** is a new commit on the feature branch or an agent report.
- **Wrap-up** starts after no progress: 60 orchestrator tool calls, the same command failing 3 times, the 8 h budget, or 45 quiet minutes twice. The mod then refuses new agents.
- **Hard stop as `BLOCKED`** if `run_finish` doesn't come within 15 more calls.
- **Every terminal state clears `/goal`.** The user can end a run with `/orchestrator-stop`.

If `run_start` doesn't exist (Claude Code before v2.1.287, or mods off), apply these rules yourself and end with `GOAL: DONE|PARTIAL|BLOCKED — <summary>`.

## Progress

When the user asks for progress or status, answer in the [status](../status/SKILL.md) format.
