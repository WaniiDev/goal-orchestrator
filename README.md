# goal-orchestrator

A Claude Code plugin that ships a goal (an issue and its sub-issues, a plan doc, or a written goal) as **one PR on one branch** with a team of sub-agents, held to its finish line by **Claude Code goal mode** (`/goal`).

## Why goal mode

A long run drifts if only a prompt holds the finish line. `/goal <condition>` re-checks the condition after every turn and starts another turn until it is met, survives `--resume`, and waits while sub-agents run. This plugin turns it on for you after the intake, so the finish line you chose is the one the session is held to.

## Real working cases

**1. Going to sleep: start it with the plugin.**

```
/goal-orchestrator:run WAN-346 and its sub-issues
```

1. Intake asks four questions: implementers (for example `Sonnet · medium`), reviewers (`Opus · xhigh`), `Away / asleep`, and `PR, merge when green`. Then it asks which final results you want.
2. The plugin writes the finish line into `RUN.md` and calls its `start_goal` tool. That queues `/goal <finish line>` exactly as if you typed it, and the turn ends.
3. `/goal` starts at once and the run continues on its own: recon, waves of implementers in their own worktrees, a review after each wave, the final gate, the PR, CI driven to green, the merge, the tracker and the final report.
4. You wake up to a merged PR, or a PR with exactly what blocks it, and the results you asked for. `/goal` shows the goal as achieved.

**2. You prefer typing /goal yourself.**

```
/goal Using goal-orchestrator, ship WAN-346 and its sub-issues as one PR: merged into main with CI green, WAN-346..364 Done with checkpoints, final report posted. I'm asleep: Sonnet medium builds, Opus xhigh reviews.
```

Claude invokes the plugin's `run` skill inside your goal, skips the questions the condition already answers, and goes. The plugin sees it is already inside a goal and does not set another.

**3. Headless or CI.**

```
claude -p "/goal Using goal-orchestrator, ship WAN-400 as one PR, CI green, PR open. --auto" --permission-mode auto
```

## What happens inside the run

1. **Intake and goal**: models and effort per role, away or around, finish line, results; then goal mode is armed.
2. **Recon and plan**: the repo's steering docs and every issue; waves of lanes that never edit the same files at the same time.
3. **Waves**: implementers work in the background, each in a worktree created from the feature branch, with their own database and port. The orchestrator merges each lane and runs the fast checks.
4. **Reviews**: a reviewer checks every wave. For UI goals, UI auditors also check, with real screenshots and motion captures. Findings become fix lanes.
5. **Final gate**: typecheck, lint, unused code, full unit and integration, schema verification, full e2e, then a whole-diff review. Flaky tests are root-caused.
6. **Deliver**: a PR with Issues, Decisions, Migrations, Ops notes and Tests. CI driven to green, the merge if you chose it, tracker checkpoints, and your final results.

After a compaction or resume, the plugin's system-prompt section and `RUN.md` bring the run back to the step it was on.

## Install

From GitHub (after pushing this folder to a repo):

```
/plugin marketplace add <owner>/<repo>
/plugin install goal-orchestrator@goal-orchestrator-marketplace
```

From a local folder:

```
/plugin marketplace add ./goal-orchestrator-marketplace
/plugin install goal-orchestrator@goal-orchestrator-marketplace
```

Or for one session: `claude --plugin-dir ./goal-orchestrator-marketplace/plugins/goal-orchestrator`.

### Claude Code cloud sessions (claude.ai/code)

Cloud sessions do not install plugins that a repository's `.claude/settings.json` enables, so install it in the cloud environment's **setup script** (environment menu in the session title bar → Edit → Setup script). The script runs before Claude starts. Put the lines after `#!/bin/bash`:

```bash
#!/bin/bash
claude plugin marketplace add WaniiDev/goal-orchestrator || true
claude plugin install goal-orchestrator@goal-orchestrator-marketplace --scope user || true
```

New sessions pick it up; running sessions do not. The setup script clones without your credentials, so this marketplace repository must be public (a private one fails with "could not read Username for 'https://github.com'"; check the session's setup log).

### Requirements

- Claude Code 2.1.293 or newer. The `start_goal` tool is a function-hooks module, an early-access surface.
- `/goal` must be available. It is off when `disableAllHooks` is set, or when managed settings allow only managed hooks. Without it the plugin falls back to the built-in `ProposeGoal` tool, or asks you to paste the `/goal` line it prints.
- For unattended runs, use auto permission mode, so turns are not stopped by permission prompts.

## Use

```
/goal-orchestrator:run <goal> [--auto]
/goal-orchestrator:status      progress as an icon list
/goal-orchestrator:report      the final results
/goal clear                    end the goal (only you do this)
```

`--auto` skips the intake and uses the defaults: Sonnet · medium to build, Opus · xhigh to review, away mode, PR only (it never merges without your yes), and the chat, tracker and PR-body results.

## Contents

- `skills/run/`: the methodology (`SKILL.md`) and its references: intake, implementer brief, review briefs, delivery, lessons from real runs.
- `skills/status/`, `skills/report/`: progress and final results formats.
- `agents/`: `implementer` (default Sonnet · medium), `reviewer` and `ui-auditor` (default Opus · xhigh). The intake's choices override these per run.
- `hooks/register.ts`: the function-hooks module.
  - The `start_goal` tool queues a real `/goal`.
  - A system-prompt section keeps the finish line through compaction.
  - It notices `/goal clear`.
  - Tests are in `hooks/register.test.ts` (`claude plugin test`).
