# goal-orchestrator

A Claude Code plugin that ships a goal (an issue and its sub-issues, a plan doc, or a written goal) as **one PR on one branch** with a team of sub-agents, verified end to end.

## What it does

1. **Intake.** One question set: which model and effort the implementers and reviewers use, whether you'll be away (fully autonomous) or around, and how far to go (branch, PR, or PR and merge when green).
2. **Recon and plan.** Reads the repo's steering docs and every issue, then plans waves of lanes that never edit the same files at the same time.
3. **Waves.** Implementer agents work in the background, each in its own worktree (created from the feature branch), with its own database and port. The orchestrator merges each lane and runs the fast checks.
4. **Reviews.** A reviewer (and, for UI goals, UI auditors with real screenshots and motion captures) checks every wave. Findings become fix lanes.
5. **Final gate.** Typecheck, lint, unused code, full unit and integration, schema verification, full e2e, then a whole-diff review. Flaky tests are root-caused.
6. **Deliver.** The PR with Issues, Decisions, Migrations, Ops notes and Tests; CI driven to green; a merge if you chose it; tracker checkpoints; and your final results.

## Install

From GitHub (after pushing this folder to a repo):

```
/plugin marketplace add <owner>/<repo>
/plugin install goal-orchestrator@goal-orchestrator-marketplace
```

From a local folder (testing):

```
/plugin marketplace add ./goal-orchestrator-marketplace
/plugin install goal-orchestrator@goal-orchestrator-marketplace
```

Or for one session: `claude --plugin-dir ./goal-orchestrator-marketplace/plugins/goal-orchestrator`.

## Use

```
/goal-orchestrator:run WAN-346 and its sub-issues
/goal-orchestrator:run docs/plan.md --auto
/goal-orchestrator:status
/goal-orchestrator:report
```

For an unattended run, pair it with `/goal` so it keeps going until a terminal state, and never past one:

```
/goal The orchestrator's latest reply ends with a line starting "GOAL: DONE", "GOAL: PARTIAL" or "GOAL: BLOCKED". Any of the three means the condition is met. Also met after 80 turns.
```

`/orchestrator-stop` ends a run by hand (as `BLOCKED`) and clears `/goal`.

`--auto` skips the intake and uses the defaults: Sonnet · medium to build, Opus · xhigh to review, away mode, PR only (never merges without your yes). Results: the chat summary, the PR body, and tracker checkpoints when a tracker is connected.

## Contents

- `skills/run/`: the method (`SKILL.md`) and four references, each read only at its step: intake, the brief template, review prompts, delivery.
- `skills/status/`, `skills/report/`: the progress and final-results formats. Only you invoke them, so they add nothing to a session's context until used.
- `hooks/register.ts` (a Claude Code mod, v2.1.287+): `run_start` / `run_finish` tools, a progress and budget watchdog (no new commit, repeated failures, time, quiet runs), `/orchestrator-stop`, `/goal clear` on every terminal state, and guards against `pkill`/`killall`, force push and `--no-verify` while a run is active. Tests: `claude plugin test plugins/goal-orchestrator`.
- `agents/implementer.md` (default Sonnet · medium), `agents/reviewer.md` and `agents/ui-auditor.md` (default Opus · xhigh). Each carries its own rules and a terse report format, so prompts carry only the lane's facts. The intake's choices override the models per run.

## Token use

- The generic rules live once, in the agent definitions. `BRIEF.md` is a ~50-line repo profile that agents read instead of the steering docs.
- References load per step; `status` and `report` load only when called.
- Lane and review reports go to files, and the orchestrator keeps one verdict line each.
- Docs-only and test-only waves skip review. The intake is a single question set.
- The watchdog stops loops before they burn tokens.
