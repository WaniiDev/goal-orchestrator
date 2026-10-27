# goal-orchestrator

A Claude Code plugin that ships a goal (an issue and its sub-issues, a plan doc, or a written goal) as **one PR on one branch** with a team of sub-agents, verified end to end.

## What it does

1. **Intake.** One question set: which model and effort the implementers and reviewers use, whether you'll be away (fully autonomous) or around, and how far to go (branch, PR, or PR and merge when green). Then the run arms `/goal` itself, so it can't lose its finish line.
2. **Recon and plan.** Reads the repo's steering docs and every issue, then plans waves of lanes that never edit the same files at the same time.
3. **Ship (a workflow).** The build runs as a dynamic workflow: a program, not a prompt, so retries, gates and stop rules run as code. For each wave:
   - **Contract first.** An agent turns the Done-when items into failing acceptance tests before any feature code exists.
   - **Lanes.** Implementer agents build in parallel, each in its own worktree from the feature branch, with its own database and port, and make the contract tests pass without editing them. A lane that needs another lane's work waits and builds again once that one merges.
   - **Re-checked claims.** An integrator re-runs every check a lane reports, compares the counts, and confirms the contract tests are untouched and no lane edited another's files. Gaps go back to the lane, at most twice; then the lane is dropped and the run ends `PARTIAL` instead of looping. High-risk lanes get a review before they merge.
   - **Merge and review.** Ready lanes merge and the fast checks run in a clean worktree. A reviewer (and, for goals with screens, UI auditors with real screenshots) checks the wave and whatever no test can prove, and findings become fix lanes.
4. **Final gate.** The full suites, up to two fix rounds, then a whole-diff review that also checks every earlier finding: fixed ones still hold, open ones are reported again or closed.
5. **Deliver.** The PR with Issues, Decisions, Migrations, Ops notes and Tests; CI driven to green; a merge if you chose it; tracker checkpoints; and your final results.

The ship phase needs dynamic workflows (the `Workflow` tool). Without them, the orchestrator drives the waves itself, as in 1.x.

## Install

At the prompt of a terminal session:

```
/plugin install goal-orchestrator --marketplace WaniiDev/goal-orchestrator
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `WaniiDev/goal-orchestrator`, then Add plugin.

To update: `claude plugin update goal-orchestrator@goal-orchestrator-marketplace`, then `/reload-plugins` or a new session. For one session from a clone: `claude --plugin-dir ./plugins/goal-orchestrator`.

### Cloud sessions (claude.ai/code)

Cloud sessions don't load plugins from your machine or from a repository's `.claude/settings.json`. Install the plugin in the cloud environment's **setup script** (environment menu in the session title bar → Edit → Setup script), which runs before Claude starts:

```bash
#!/bin/bash
claude plugin marketplace add WaniiDev/goal-orchestrator || true
claude plugin install goal-orchestrator@goal-orchestrator-marketplace --scope user || true
```

- New sessions pick it up; running ones don't. The script clones without your credentials, so this repository must stay public.
- The environment caches the script's result and runs it again only when the script or its allowed hosts change, or after about 7 days. After a release, edit the script (a comment will do) so new sessions get the new version.
- To try a branch before it reaches `main`, pin it: `claude plugin marketplace add WaniiDev/goal-orchestrator#<branch>`.

## Use

```
/goal-orchestrator:run WAN-346 and its sub-issues
/goal-orchestrator:run docs/plan.md --auto
/goal-orchestrator:status
/goal-orchestrator:report
```

Or ask in plain words ("ship WAN-346 and its sub-issues as one PR while I sleep"). Claude can start the run skill itself, so another session, or a `/goal` that names goal-orchestrator, can start a run too.

After the intake, the run arms `/goal` itself (`start_goal`), so it keeps going until a terminal state and never past one: goal mode waits while the ship workflow runs, and every terminal state clears it. Watch the ship phase live with `/workflows`. `/orchestrator-stop` ends a run by hand (as `BLOCKED`) and clears `/goal`.

Headless (`claude -p`): set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. Otherwise print mode stops background work 10 minutes after the last turn, which cuts the ship workflow off mid-run.

`--auto` skips the intake and uses the defaults: Sonnet · medium to build, Opus · xhigh to review, away mode, PR only (branch only when origin is missing or a local path; never merges without your yes). Results: the chat summary, the PR body, and tracker checkpoints when a tracker connector exists.

## Contents

- `skills/run/`: the method (`SKILL.md`) and its references, each read only at its step: intake, the brief template, delivery, and the manual waves for sessions without workflows (with their review prompts).
- `workflows/ship.js`: the ship phase. Its input is the plan the run skill writes; it returns the outcome, what shipped and what didn't (and why), the gate's checks, the findings fixed and still open, decisions, and the output tokens it spent.
- `skills/status/`, `skills/report/`: the progress and final-results formats. Only you invoke them, so they add nothing to a session's context until used.
- `hooks/register.tsx` (a Claude Code mod, v2.1.287+): a band above the prompt while a run is active (one line: a thin ring for the time budget in the desktop app, Claude's ✻ in the terminal; amber when the run stalls, a mark when it ends), `start_goal` (arms `/goal` after the intake and keeps the finish line in the system prompt and in what a compaction keeps), `run_start` / `run_finish` tools, a progress and budget watchdog (no new commit, repeated failures, time, quiet runs), `/orchestrator-stop`, `/goal clear` on every terminal state, and guards against `pkill`/`killall`, force push and `--no-verify` while a run is active.
- `agents/implementer.md` (default Sonnet · medium), `agents/reviewer.md` and `agents/ui-auditor.md` (default Opus · xhigh), `agents/integrator.md` (Sonnet · low: re-checks, merges, the gate). Each carries its own rules, so prompts carry only the lane's facts. The intake's choices override the models per run.
- Tests: `claude plugin test plugins/goal-orchestrator` (the mod) and `node --test plugins/goal-orchestrator/tests/ship.test.mjs` (the workflow's control flow, with every agent faked).

## Token use

- The run's control flow is code: the orchestrator's context holds the plan and one result, not every lane report, retry and merge.
- The generic rules live once, in the agent definitions. `BRIEF.md` is a ~50-line repo profile that agents read instead of the steering docs.
- Agents don't load CLAUDE.md (`omitClaudeMd`; the brief carries the rules that apply) and see only the tools they use, not every tool and MCP server the session has.
- Agents report schema-checked JSON, so nothing is parsed twice or re-asked. Mechanical re-checks and merges run on Sonnet · low.
- Docs-only and test-only lanes skip contract tests and review. A blocked lane stops at once instead of retrying.
- The watchdog stops loops before they burn tokens.
- Measured: the final results show the ship phase's output tokens, and, in the desktop app, your plan's 5-hour and weekly usage before and after the run and the orchestrator's context size (read with the app's `get_usage` tool; the CLI and cloud sessions don't have it).
