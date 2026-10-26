---
name: run
description: Ship a goal (a tracker issue and its sub-issues, a plan doc, or a written goal) as ONE pull request on ONE branch. An intake asks which models, effort, mode and finish line to use; goal mode holds the finish line; the ship workflow builds it in waves with contract tests first, re-checked claims, reviews and a final gate; you deliver it.
when_to_use: The user runs /goal-orchestrator:run, a /goal condition or prompt names goal-orchestrator, or the user asks to ship several issues or a multi-step goal with sub-agents "as one PR" or "while I sleep".
argument-hint: "<goal: issue key(s), plan doc path, or a sentence> [--auto]"
---

# Goal orchestrator

You plan and deliver; the `ship` workflow runs the build. Keep conclusions in your context, not file contents.

Goal: $ARGUMENTS

Read each reference only at its step: [intake](references/intake.md) (0), [brief template](references/brief-template.md) (2), [delivery](references/delivery.md) (4). Progress format: [status](../status/SKILL.md). Final results: [report](../report/SKILL.md).

**State** lives in the scratchpad (else `.orchestrator/` in the session temp dir): `RUN.md` (choices, plan, the workflow's run ID and transcript folder, gate results), `DECISIONS.md` (one line per decision: what, why, which source), `BRIEF.md`, `reports/`. After a compaction, re-read `RUN.md` first. After a container restart, restart services (for example the DB).

## Step 0: Intake

Follow [intake](references/intake.md).
- **Away**: after intake, never ask or wait. Decide by issue text > plan doc > design reference > repo docs and ADRs > smallest safe option; log each decision.
- **Around**: ask only about scope, architecture, data model or anything destructive; still log decisions.

## Step 0b: Arm goal mode

Right after the intake (`--auto` included), before recon, so the run can't lose its finish line. Goal mode re-checks the condition after every turn, waits while the workflow runs, and the mod clears it when the run ends.
1. Write the condition into `RUN.md`, at most 4,000 characters, judged from the conversation alone: "goal-orchestrator run for <goal>, state in <RUN.md path>. Met when the orchestrator's latest reply ends with a line starting `GOAL: DONE`, `GOAL: PARTIAL` or `GOAL: BLOCKED`. Until then the run works toward: every issue's Done-when met, the final gate green, and <branch pushed | PR open with CI green | PR merged into <base> with CI green>. Also met after 80 turns."
2. Already inside a `/goal` that names this plugin: it is set. Record it in `RUN.md` and go on.
3. Otherwise, load the run tools with one `ToolSearch` (`select:mcp__goal-orchestrator__start_goal,mcp__goal-orchestrator__run_start,mcp__goal-orchestrator__run_finish`). Then, first match wins:
   - `start_goal` with `condition` and `run_file` (the absolute `RUN.md` path): say in one line that goal mode is armed and end your turn. `/goal` starts when the turn ends and brings you back (Step 0c).
   - `ProposeGoal`, if the session offers it: the condition cut to 500 characters (the full one stays in `RUN.md`); `ask_user: false` only when the user picked the finish line. End your turn.
   - Neither: around, give the user `/goal <condition>` to paste and wait; away, say so in one line and carry on.
4. Never clear or replace the goal yourself; the user can `/goal clear`.

## Step 0c: Resume

On every turn of a run (after `/goal` starts one, a compaction, a resume or the workflow's result), read `RUN.md` first and continue from the step it records. Never repeat the intake for a run that has a `RUN.md`.

## Step 1: Recon (cheap; send wide sweeps to an Explore agent)

1. From the steering files (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, `README`, `TESTING`) and the CI config: app root, package manager, check commands (typecheck, lint, unused code, unit, integration, e2e, schema verification), invariants, doc owners, commit and PR conventions, tracker rules. Use the repo's code-graph index if it has one.
2. The goal: every issue (Done-when, Not in scope, links), any plan doc and design reference. If a written goal has no Done-when items, write them into `RUN.md`. Write each item so a test can prove it.
3. Environment: a test DB (native; no Docker unless the repo requires it), a browser for e2e, network access, and how each agent gets its own DB and port.
4. Create or check out the feature branch (the session's designated branch if given), push it, and run `git config rerere.enabled true`. Note its base: `git merge-base <default-branch> <feature-branch>`.
5. Run the fast checks once on the base. List any failures in `BRIEF.md` as pre-existing, so agents don't re-prove them.
6. Call `run_start` (branch, absolute repo path, any budget the user gave).

## Step 2: Plan

- A **lane** is one issue (or a tight group) that one implementer owns end to end, with named files. A **wave** is 3–5 lanes with disjoint files. Order by dependency: schema and server before UI, shared primitives before the screens that use them; a lane that needs another lane's code goes in a later wave. Docs-only and test-only lanes ride along.
- Write `BRIEF.md` from the [template](references/brief-template.md). It is the distilled repo profile that every agent reads instead of the steering docs.
- Write the plan into `RUN.md` as the workflow's input:
  ```json
  {
    "repo": "<absolute main checkout>", "branch": "<feature branch>", "base": "<merge-base sha>", "brief": "<absolute BRIEF.md path>",
    "mode": "away | around",
    "models": { "implementer": { "model": "sonnet", "effort": "medium" }, "reviewer": { "model": "opus", "effort": "xhigh" } },
    "checks": { "fast": ["<typecheck>", "<lint>", "<unit>"], "full": ["<every gate command>"] },
    "waves": [{ "lanes": [{
      "id": "<short-id>", "issues": ["<KEY>"], "doneWhen": ["<testable item>"], "owns": ["<files or dirs>"], "avoid": ["<files>"],
      "db": "<db>", "port": 5174, "e2e": "<filter>", "kind": "code | docs | test", "risk": "high", "ui": true
    }] }],
    "ui": { "reference": "<design reference, if any>", "standard": "<house design rules>", "sizes": "<sizes and locales>", "areas": [{ "name": "<lists | dialogs | motion>", "db": "<db>", "port": 5181 }] }
  }
  ```
  `models` holds the intake's choices. `kind` defaults to `code`; `risk: "high"` (auth, money, data loss, migrations) adds a review before that lane merges; `ui: true` marks lanes the UI audits cover. Give every goal with screens a `ui`, even with no design reference: leave `reference` out and the auditors check the screen's Done-when items at each size (`sizes` defaults to desktop 1280×720 and phone 390×844). `areas` splits the audits, one auditor per area with its own DB and port; with none, one auditor covers every screen. Leave `ui` out only for goals without screens. Optional: `limits` (`laneRetries` 2, `gateRounds` 2), `"contract": false` to skip contract tests, `models.integrator`.
- In the session's task list: "Ship" (one item; the workflow shows its own progress) and "Deliver".

## Step 3: Ship

1. Launch `Workflow` with `name: "goal-orchestrator:ship"` and `args`: the plan object itself, not a JSON string. If that name isn't found, pass `scriptPath`: `workflows/ship.js` two folders above this skill's base directory. If the result has `error`, fix the plan and relaunch. Note the `runId` and `transcriptDir` in `RUN.md`.
2. Per wave, the workflow has failing contract tests written from the Done-when items, runs one implementer per lane in its own worktree, re-runs every claim, sends exact gaps back (at most 2 retries, then the lane is dropped), merges (a lane that waited for another lane of its wave builds again once that one merges), reviews (UI audits included) and turns findings into fix lanes. Then the final gate, with up to 2 fix rounds, and a whole-diff review. Don't poll it and don't duplicate its work: end your turn with the line `Waiting for the ship workflow.`; the result arrives as a task notification. If anything wakes you before it (a goal check-in, the watchdog), answer with that line again and no tool calls.
3. When the result arrives, first save it verbatim to `reports/ship.json` (the report skill reads it). Then record in `RUN.md` the head, the gate checks, what shipped and what didn't and why, and the `untestable` items; append every lane's decisions, fix lanes included, to `DECISIONS.md`.
4. `questions` (around mode): ask the user, add each answer to its lane as `"answers": [...]`, and relaunch with `resumeFromRunId`; finished agents return their saved results. Relaunch the same way if the run was cut off.
5. Open security findings are never dropped: fix them, ask (around), or put them first in the PR (away).
6. One ship run per goal: don't start another for lanes that didn't ship. They go in the PR and the results as not shipped, with the reasons.

Without a `Workflow` tool (workflows off), run [manual waves](references/manual-waves.md) instead.

## Step 4: Deliver

Follow [delivery](references/delivery.md):
1. Open the PR (if the finish line includes it): Issues from `shipped`, the gate's checks, the decisions; for `PARTIAL`, a draft PR that lists `notShipped` with the reasons and the open findings.
2. Drive CI to green, then merge if the finish line says so.
3. Update the tracker.
4. Read [report](../report/SKILL.md) as a file (only the user can invoke it as a skill) and write the final results in its format.
5. Clean up: remove the worktrees in the result's `leftover`, delete the `contract-wave-*` branches and the merged `lane-*` ones (`git branch -d` keeps a dropped lane's unmerged work), and stop watching the PR after the merge.
6. Call `run_finish` last.

## Stop conditions

Every run ends in exactly one terminal state, through `run_finish`:
- `DONE`: every issue shipped and verified at the chosen finish line.
- `PARTIAL`: some issues shipped. A draft PR (or the pushed branch) lists what didn't ship and why.
- `BLOCKED`: only the user can unblock it (auth, a secret or service, a refused permission, a merge that needs approval or is blocked by branch protection), or the run can't progress.

Start from the workflow's `outcome`; delivery can lower it, never raise it. Finish instead of retrying when the same check fails the same way twice after a fix, or when the watchdog says to wrap up.

Before `run_finish`, in order: push, update `RUN.md`, `DECISIONS.md` and the PR or draft PR, remove the worktrees. After `run_finish`, make no more tool calls (the app's own end-of-turn wrap-up excepted), and end the reply with the `GOAL: …` line it returns. In away mode a block is not a question: finish, and the user reads the line when they're back.

The plugin's mod enforces this:
- **Progress** is a new commit on the feature branch or an agent report; an agent at work keeps the run from looking quiet.
- **Wrap-up** starts after no progress: 60 orchestrator tool calls, the same command failing 3 times, the 8 h budget, or 45 quiet minutes twice. The mod then refuses new agents and workflows.
- **Hard stop as `BLOCKED`** if `run_finish` doesn't come within 15 more calls.
- **Every terminal state clears `/goal`.** The user can end a run with `/orchestrator-stop`.

If `run_start` doesn't exist (Claude Code before v2.1.287, or mods off), apply these rules yourself and end with `GOAL: DONE|PARTIAL|BLOCKED — <summary>`.

## Progress

When the user asks for progress or status, answer in the [status](../status/SKILL.md) format.
