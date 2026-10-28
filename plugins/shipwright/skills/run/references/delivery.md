# Delivery

## PR body
Mirror the repo's PR template if it has one. Otherwise:
```markdown
<one paragraph: what this delivers, for whom; links to the tracker issues>

## Issues
| Issue | What shipped |
| --- | --- |

## Decisions
Made without a human in the loop (issue text > plan doc > design > smallest safe option).
**<theme>**
- <decision and reason>

## Migrations
<files, what they change, idempotency, how verification covers them; or "None">

## Ops notes
<new env vars, defaults, operational effects, removed endpoints; or "None">

## Tests
Final gate on `<sha>` (<environment>):
| Command | Result |
| --- | --- |

Still failing (a red gate only, from `gate.failures`): <each problem and its files>

Checked by hand: <each `untestable` item and each lane note (`lanes[].notes`) from the ship result, and how it was checked, or "None">

Reviews: <rounds run; the findings fixed (`fixed`); each finding still open (`open`) and each nit (`reviews[].nits`), with why it stays>
```
Lane notes and nits are as of their lane or round, and a later fix may have closed them: check each against the final head and leave out what no longer holds. End the body with the session's attribution lines. If the gate runs again after the PR is opened, update the numbers.

## Drive to green
- Watch the PR with the session's own PR tools (in the desktop app, `ccd_pr`); never poll with sleep or a timer.
- Red CI: read the job log. If the failure is this PR's, fix it, prove it locally, push. If it's infrastructure the diff doesn't touch, comment once on the PR with the evidence and re-run the failed job once.
- Never skip, disable or quarantine a test. Never push an empty commit, and never close and reopen to kick CI.
- Merge only for `pr+merge` (or a later explicit yes), with CI green and the PR mergeable. Pass the expected head SHA, and use the repo's merge method (merge commit by default).
- If required approvals or branch protection block the merge, finish as `BLOCKED` with that action for the user. Never use an admin override.
- After the merge, any follow-up work starts from the latest default branch.

## Tracker
Reach it the way the repo does; `docs/agents/issue-tracker.md` says which, if the repo has one. A connector (Linear, Jira), `gh` for GitHub Issues, `glab` for GitLab, or the issue files themselves for a local-markdown tracker (a checkpoint is a dated section appended to the file, and the state its `Status:` line). With none of these, skip the tracker and say so in the results.
Along the way, not only at the end: In Progress with a checkpoint at the plan, a checkpoint per issue when the ship result arrives, In Review with the PR, Done after the merge. Skip all of it when `RUN.md`'s `defaults:` drops tracker updates.
- Tick only the Done-when items that are met and verified. Never add progress logs to the description.
- Post one checkpoint per issue in the repo's format; lint it first if the repo ships a linter. Typical sections: State, Done, Next, Verify (`` `cmd` — pass|fail|skipped, detail ``), Branch, Watch out.
- States: In Progress while working, In Review with an open PR, Done only after the merge (or as the repo's rules say). Link the PR.
