# Manual waves

Only for a session without the `Workflow` tool. You drive what the ship workflow would: the plan's waves, then the final gate. Load `SendMessage` with one `ToolSearch` (`select:SendMessage`).

## Run a wave

For each lane:
1. `git worktree add -b lane-<id> <repo>/.claude/worktrees/lane-<id> <feature-branch>`. Don't use `isolation: "worktree"`: it branches from the default branch. Copy in any untracked local test config the lane needs.
2. Launch `Agent` with `subagent_type: "goal-orchestrator:implementer"`, `name: "lane-<id>"`, and `model` and `effort` from `RUN.md`; it runs in the background. The prompt holds only: the worktree path, the `BRIEF.md` path, the issue(s) and Done-when items, owned files and files to avoid, the DB and port, and the e2e filter. The agent definition carries its rules and report format.
3. While lanes run, prepare the next wave. Don't duplicate their work.

When a lane reports:
- Save the report to `reports/lane-<id>.md` and keep one verdict line in context.
- Spot-check one claim by re-running one command.
- Send gaps back to the same agent (`SendMessage` to `lane-<id>`) with the exact gap. After 2 retries, re-plan or drop the lane.
- Merge: `git merge --no-ff lane-<id> -m "Merge <ISSUE>: <summary>"` plus attribution trailers. Resolve conflicts per hunk, keeping both sides' intent.
- Run the fast checks on the merged area in a clean worktree of the new head (`git worktree add --detach <repo>/.claude/worktrees/check-<n> HEAD`, removed afterwards), not in the main checkout, whose test runner would pick up the lane worktrees. Stage everything you touched (`git status --short` is empty after the commit), then push.

## Review the wave

Skip docs-only and test-only waves. Otherwise launch `goal-orchestrator:reviewer` (model and effort from `RUN.md`) in a fresh worktree on the feature head, with the wave prompt from [review prompts](review-brief.md). For UI work, also launch one `goal-orchestrator:ui-auditor` per area (lists, dialogs and drawers, motion), each with its own DB and port.

Save the findings to `reports/`. Turn must-fix and should-fix findings into fix lanes grouped by file. For each finding you drop, log the reason in `DECISIONS.md`. Re-review only the areas a large fix touched.

## Final gate

If the base moved, merge it in first; prefer that to rebasing. In a clean worktree of the feature head, run everything (background long runs) and record exact results in `RUN.md`:
- typecheck for app and tests, lint, unused code;
- the full unit and integration suites with the real DB;
- schema verification;
- the full e2e suite.

Then run one whole-diff review, plus a visual re-check for UI goals. Fix what it finds, then re-run the gate. A flaky test is root-caused (product bug or test bug; note failures near midnight UTC), and the fix is proven with about 10 repeats plus one full-suite run.
