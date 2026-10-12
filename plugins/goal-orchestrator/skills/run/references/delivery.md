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

Reviews: <rounds run; every finding fixed or logged>
```
End the body with the session's attribution lines. If the gate runs again after the PR is opened, update the numbers.

## Drive to green
- Subscribe to PR activity; never poll with sleep.
- Red CI: read the job log. If the failure is this PR's, fix it, prove it locally, push. If it's infrastructure the diff doesn't touch, comment once on the PR with the evidence and re-run the failed job once.
- Never skip, disable or quarantine a test. Never push an empty commit, and never close and reopen to kick CI.
- Merge only for `pr+merge` (or a later explicit yes), with CI green and the PR mergeable. Pass the expected head SHA, and use the repo's merge method (merge commit by default).
- If required approvals or branch protection block the merge, finish as `BLOCKED` with that action for the user. Never use an admin override.
- After the merge, any follow-up work starts from the latest default branch.

## Tracker
- Tick only the Done-when items that are met and verified. Never add progress logs to the description.
- Post one checkpoint per issue in the repo's format; lint it first if the repo ships a linter. Typical sections: State, Done, Next, Verify (`` `cmd` — pass|fail|skipped, detail ``), Branch, Watch out.
- States: In Progress while working, In Review with an open PR, Done only after the merge (or as the repo's rules say). Link the PR.
