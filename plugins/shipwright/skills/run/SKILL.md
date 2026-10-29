---
name: run
description: Ship a goal (a tracker issue and its sub-issues, a plan doc, or a written goal) as ONE pull request on ONE branch. An intake asks which models, effort, mode and finish line to use; goal mode holds the finish line; you drive implementer and reviewer sub-agents in waves, with contract tests first, re-checked claims, reviews and a final gate, and deliver it.
when_to_use: The user runs /shipwright:run, a /goal condition or prompt names shipwright, or the user asks to ship several issues or a multi-step goal with sub-agents "as one PR" or "while I sleep".
argument-hint: "<goal: issue key(s), plan doc path, or a sentence> [--auto]"
---

# Shipwright

You plan, check, merge and deliver; sub-agents build and review. Keep conclusions in your context, not file contents.

Goal: $ARGUMENTS

Read each reference only at its step: [intake](references/intake.md) (0), [brief template](references/brief-template.md) (2), [ship](references/ship.md) (3), [delivery](references/delivery.md) (4). Progress format: [status](../status/SKILL.md). Final results: [report](../report/SKILL.md).

**State** lives in the scratchpad (else `.shipwright/` in the session temp dir): `RUN.md` (choices, plan, the lanes table, gate results), `DECISIONS.md` (one line per decision: what, why, which source), `BRIEF.md`, `reports/`. After a compaction, re-read `RUN.md` first. After a container restart, restart services (for example the DB).

## Every run

Without being told, every run:
- **Goes in one go**: from the intake to the finish line without stopping. Never ask "shall I continue?", wait for a go-ahead on the plan, or split the goal into several runs or sessions. Around mode still asks only what Step 0 allows.
- **Runs in parallel**: wide recon sweeps go to several Explore agents at once, each wave holds as many lanes as have disjoint files, and independent checks and tracker updates go out together.
- **Updates the issues along the way** (whenever the run can reach the tracker; see [delivery](references/delivery.md)), following [delivery](references/delivery.md)'s Tracker rules: In Progress with the plan (Step 2), a checkpoint per issue when the ship result arrives (Step 3), In Review with the PR and Done after the merge (Step 4).

The intake's "How to run" question can leave each one out, and so can the user's words ("no tracker updates", "one lane at a time"); `RUN.md`'s `defaults:` line holds what stays on.

## Step 0: Intake

Follow [intake](references/intake.md).
- **Away**: after intake, never ask or wait. Decide by issue text > plan doc > design reference > repo docs and ADRs > smallest safe option; log each decision.
- **Around**: ask only about scope, architecture, data model or anything destructive; still log decisions.

## Step 0a: Usage at the start

Load `mcp__ccd_session_mgmt__get_usage` with `ToolSearch` (`select:mcp__ccd_session_mgmt__get_usage`) and call it. Write `usage.before` into `RUN.md`: the time, each plan window's label, `percentUsed` and `resetsAt`, and the context's `tokensUsed`. Without the tool (the CLI, a cloud session) or with `plan.status` other than `ok`, write `usage: not measured (<why>)` and go on. Step 4 takes the matching reading.

## Step 0b: Arm goal mode

Right after the intake (`--auto` included), before recon, so the run can't lose its finish line. Goal mode re-checks the condition after every turn, waits while the agents run, and the mod clears it when the run ends.
1. Write the condition into `RUN.md`, at most 4,000 characters, judged from the conversation alone: "shipwright run for <goal>, state in <RUN.md path>. Met when the orchestrator's latest reply ends with a line starting `GOAL: DONE`, `GOAL: PARTIAL` or `GOAL: BLOCKED`. Until then the run works toward: every issue's Done-when met, the final gate green, and <branch pushed | PR open with CI green | PR merged into <base> with CI green>. Also met after 80 turns."
2. Already inside a `/goal` that names this plugin: it is set. Record it in `RUN.md` and go on.
3. Otherwise, load the run tools with one `ToolSearch` (`select:mcp__shipwright__start_goal,mcp__shipwright__run_start,mcp__shipwright__run_finish`). Then, first match wins:
   - `start_goal` with `condition` and `run_file` (the absolute `RUN.md` path): say in one line that goal mode is armed and end your turn. `/goal` starts when the turn ends and brings you back (Step 0c).
   - `ProposeGoal`, if the session offers it: the condition cut to 500 characters (the full one stays in `RUN.md`); `ask_user: false` only when the user picked the finish line. End your turn.
   - Neither: around, give the user `/goal <condition>` to paste and wait; away, say so in one line and carry on.
4. Never clear or replace the goal yourself; the user can `/goal clear`.

## Step 0c: Resume

On every turn of a run (after `/goal` starts one, a compaction, a resume or an agent's result), read `RUN.md` first and continue from the step it records. Never repeat the intake for a run that has a `RUN.md`.

## Step 1: Recon (cheap; send wide sweeps to an Explore agent)

1. From the steering files (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, `README`, `TESTING`) and the CI config: app root, package manager, check commands (typecheck, lint, unused code, unit, integration, e2e, schema verification), invariants, doc owners, commit and PR conventions, tracker rules. Use the repo's code-graph index if it has one.
2. The goal: every issue (Done-when, Not in scope, links), any plan doc and design reference. If a written goal has no Done-when items, write them into `RUN.md`. Write each item so a test can prove it.
3. Environment: a test DB (native; no Docker unless the repo requires it), a browser for e2e, network access, and how each agent gets its own DB and port.
4. Create or check out the feature branch (the session's designated branch if given), push it (only when there is a remote), and run `git config rerere.enabled true`. Note its base: `git merge-base <default-branch> <feature-branch>`.
5. Run the fast checks once on the base. List any failures in `BRIEF.md` as pre-existing, so agents don't re-prove them. If the install leaves files git doesn't ignore (a linked `node_modules` slips past a `node_modules/` pattern), add them once to `$(git rev-parse --git-common-dir)/info/exclude`, which every worktree shares; agents don't write git's shared files.
6. Call `run_start` (branch, absolute repo path, `max_hours` from `RUN.md`'s `budget:`).

## Step 2: Plan

- A **lane** is one issue (or a tight group) that one implementer owns end to end, with named files. A **wave** is as many lanes as have disjoint files (one lane per wave when `defaults:` drops parallel). Order by dependency: schema and server before UI, shared primitives before the screens that use them; a lane that needs another lane's code goes in a later wave. Docs-only and test-only lanes ride along.
- Keep waves few, 3 or fewer where the dependencies allow: each wave pays a contract, a merge and a review before the next can start. A chain of small tickets that each need the one before (A, then B, then C) is one lane whose implementer builds them in order, not a wave each.
- **Models per lane** (only under `--auto`, where the intake didn't ask): give each lane `model` and `effort` by what recon learned. Docs, copy or renames only: `haiku` · `low`. A well-specified feature: `sonnet` · `medium`. `risk: "high"`, or a big lane (3+ issues, or about 12+ Done-when items): `opus` · `high`. Reviewers: `opus` · `xhigh` when any lane is high-risk or there are 2+ waves, else `opus` · `high`. Log each choice and why in `DECISIONS.md`. A model the user named wins.
- You write no product code: shared code (types, primitives, scaffolding) is a lane of an early wave, so it gets contract tests and a review like the rest. Before launching, check each wave: no lane's Done-when items need code that another lane of the same wave owns.
- Every way the goal says to run the app (a dev server through a proxy, a production start) is a Done-when item of the lane that adds it, proven by an e2e smoke test that adds and reads data through it: the gate's e2e runs only one of them.
- Write `BRIEF.md` from the [template](references/brief-template.md). It is the distilled repo profile that every agent reads instead of the steering docs.
- Write the plan into `RUN.md`:
  ```json
  {
    "repo": "<absolute main checkout>", "branch": "<feature branch>", "base": "<merge-base sha>", "brief": "<absolute BRIEF.md path>",
    "mode": "away | around",
    "models": { "implementer": { "model": "sonnet", "effort": "medium" }, "reviewer": { "model": "opus", "effort": "xhigh" } },
    "checks": { "fast": ["<typecheck>", "<lint>", "<unit>"], "full": ["<every gate command>"] },
    "waves": [{ "lanes": [{
      "id": "<short-id>", "issues": ["<KEY>"], "doneWhen": ["<testable item>"], "owns": ["<files or dirs>"], "avoid": ["<files>"],
      "db": "<db>", "port": 5174, "e2e": "<filter>", "kind": "code | docs | test", "risk": "high", "model": "<alias>", "effort": "<level>"
    }] }],
    "ui": { "reference": "<design reference, if any>", "standard": "<house design rules>", "sizes": "<sizes and locales>", "areas": [{ "name": "<lists | dialogs | motion>", "db": "<db>", "port": 5181 }] }
  }
  ```
  `models` holds the intake's choices; a lane's own `model` and `effort` (the `--auto` picks above) override `models.implementer` for that lane. `kind` defaults to `code`; `risk: "high"` (auth, money, data loss, migrations) adds a review before that lane merges when other lanes build alongside it. Give every goal with screens a `ui`, even with no design reference: leave `reference` out and the auditors check the screen's Done-when items at each size (`sizes` defaults to desktop 1280×720 and phone 390×844). The screens are audited once, at the final gate. `areas` splits that audit, one auditor per area with its own DB and port; with none, one auditor covers every screen. Leave `ui` out for goals without screens, or when `RUN.md` says `ui: skip`; `ui: desktop` sets `sizes` to desktop 1280×720 only. Set `"push": false` when the repo has no remote. Set `"contract": false` when `defaults:` drops contract.
- In the session's task list: one item per wave, then "Final gate" and "Deliver".
- Unless `RUN.md` turns tracker updates off: move each issue to In Progress and post a checkpoint naming its lane and wave. Read [delivery](references/delivery.md)'s Tracker section for the format.

## Step 3: Ship

1. Follow [ship](references/ship.md): per wave, the contract tests, one implementer per lane in its own worktree, your check of each report (gaps go back to the same agent, at most 2 retries, then the lane is dropped), a merge as each lane is ready, and one review whose must and security findings become fix lanes. Then the final gate, with up to 2 fix rounds, and the whole-diff review with the UI audits. It ends with `reports/ship.json`.
2. Add to `RUN.md` the head, the gate checks and `gate.failures`, what shipped and what didn't and why, the `untestable` and `blocked` items, any `foreign` failures, the findings fixed and still open, and `tokens`; append every lane's decisions, fix lanes included, to `DECISIONS.md`. Unless tracker updates are off, post a checkpoint on each issue: shipped (with the checks that prove it) or not shipped and why.
3. Open security findings are never dropped: fix them, ask (around), or put them first in the PR (away).
4. Lanes that didn't ship go in the PR and the results as not shipped, with the reasons; don't start another run for them.

## Step 4: Deliver

Follow [delivery](references/delivery.md):
1. Open the PR (if the finish line includes it): Issues from `shipped`, the gate's checks, the decisions; for `PARTIAL`, a draft PR that lists `notShipped` with the reasons, the open findings, and a red gate's `gate.failures`.
2. Drive CI to green, then merge if the finish line says so.
3. Update the tracker.
4. If Step 0a measured usage, call `get_usage` again and write `usage.after` into `RUN.md` the same way. Then read [report](../report/SKILL.md) as a file (only the user can invoke it as a skill) and write the final results in its format.
5. Clean up: remove the worktrees in `leftover` and any left under `.claude/worktrees/`, delete the `contract-*` branches and the merged `lane-*` ones (`git branch -d` keeps a dropped lane's unmerged work), and stop watching the PR after the merge.
6. Call `run_finish` last.

## Stop conditions

Every run ends in exactly one terminal state, through `run_finish`:
- `DONE`: every issue shipped and verified at the chosen finish line.
- `PARTIAL`: some issues shipped. A draft PR (or the pushed branch) lists what didn't ship and why.
- `BLOCKED`: only the user can unblock it (auth, a secret or service, a refused permission, a merge that needs approval or is blocked by branch protection), or the run can't progress.

Start from `reports/ship.json`'s `outcome`; delivery can lower it, never raise it. Finish instead of retrying when the same check fails the same way twice after a fix, or when the watchdog says to wrap up.

Before `run_finish`, in order: push (when there is a remote), update `RUN.md`, `DECISIONS.md` and the PR or draft PR, remove the worktrees. After `run_finish`, make no more tool calls (the app's own end-of-turn wrap-up excepted), and end the reply with the `GOAL: …` line it returns. In away mode a block is not a question: finish, and the user reads the line when they're back.

The plugin's mod enforces this with a watchdog and says what to do when one of its limits trips; follow its notices. Without `run_start` (Claude Code before v2.1.287, or mods off), wrap up yourself after 60 tool calls with no new commit, the same command failing 3 times, or the time budget, and end with `GOAL: DONE|PARTIAL|BLOCKED — <summary>`.

## Progress

When the user asks for progress or status, answer in the [status](../status/SKILL.md) format.
