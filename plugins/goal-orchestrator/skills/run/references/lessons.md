# Lessons from real runs

Each of these cost a run an hour or more. Apply them by default.

## Worktrees and git
- **`isolation: "worktree"` branches from the default branch**, not your feature branch. Agents then build on a stale base. Create each lane's worktree yourself from the feature branch (`git worktree add -b lane-x <path> <feature-branch>`) and hand the path to the agent.
- **`git reset --hard` inside an agent may be refused** by the permission classifier. Do not design steps that need it; a fresh worktree on the right commit needs no reset. Never ask an agent to route around a refusal.
- **Stage every file you edited while resolving a merge before committing it.** One run pushed a merge commit that did not compile because two fixes stayed in the working tree. Check `git status --short` is empty after each commit.
- Turn on `git rerere`. If you must rebase a branch that contains merges, train rerere from the existing merge resolutions first, then compare the rebased tree with a test merge of the old head (`git diff` must be empty).
- A merge from the base branch that renamed a file (for example a migration renumbered to avoid a clash) is dropped by `rebase --rebase-merges`. Re-check renames after a rebase.
- After a PR merges, follow-up work starts from the latest default branch, never on top of the merged history.

## Agents
- **Sub-agents cannot write report files** (the harness refuses). They return findings as text; you save them.
- **Give every agent its own database and port**, and forbid touching others'. Shared databases make journeys flaky as data piles up.
- **Never let an agent kill by pattern** (`pkill -f`, `kill $(pgrep …)`). One run killed other lanes' servers. Kill only PIDs you launched.
- Agents report "all green" while a check failed when they read `| tail`. Ask for exact commands and counts; the lane gate re-runs them before every merge.
- The costly bugs of one real run (a lock-order deadlock, a draft that silently overwrote another admin's change) sat in lanes that touched concurrency and data integrity. Tag such lanes high-risk so they get their own review before they merge, not a wave later.
- Tests passing did not mean the screens matched the design: a UI goal shipped green and came back with 118 visual and motion findings. The UI audit runs before the PR opens.
- Long-running agents lose track of shared-file ownership. Name the files each lane owns and the files to avoid, in every prompt.

## Tests
- **Do not export feature flags meant for e2e when running unit tests.** One gate failed 15 unit tests only because the flag was set for the whole script.
- A test that fails once under the full suite is not "flaky" until root-caused. Twice it was a real product race (an own write captioned as someone else's live change); once it was a test that sampled from the wrong baseline. Prove fixes with `--repeat-each=10` and one run inside the full suite.
- Time-of-day bugs exist (relative times crossing midnight). Note when a failure happens near midnight UTC.
- CI smoke can fail for infrastructure (a headless browser that could not start on a cold runner). Read the server log before blaming the diff; comment once and re-run once.

## Containers
- The container can restart mid-run and stop background jobs. Keep `RUN.md` current, push after every merge, and re-create long jobs after a restart (`service postgresql start` etc.).
- Files the user can open are only those in the working directory or scratchpad. Put deliverables there.

## Goal mode
- The `/goal` evaluator reads only the conversation: it runs no commands and opens no files. End each milestone with a sentence that states what is now true, with its evidence (merge SHA, CI run, checkpoint link), so the evaluator can see it.
- While a sub-agent or a background shell is still running, evaluation waits for the next turn with nothing in the background. Ending the turn while agents run is the right way to wait: never poll.
- Check-ins after 30 minutes of background work come from goal mode itself. `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` tunes them; 0 turns off check-ins and automatic retries.
- The stall guard stops the loop after several turns with no tool use. Every continuation should take a real step: a tool call, not a status paragraph.
- `/goal` does not change the permission mode. Unattended runs need auto mode, or turns stall on permission prompts.
- Never clear or replace the goal yourself. A new `/goal` replaces the old one, and `/clear` removes it.
