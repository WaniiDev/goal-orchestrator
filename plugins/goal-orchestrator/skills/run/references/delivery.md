# Delivery

## Decisions log (`DECISIONS.md`, kept from the first decision)

One line per decision: what was decided, why, and which source ranked it (issue text, plan, design, repo docs, smallest safe option). In away mode this log is the user's only window into the run. Group it by theme when it goes into the PR.

## PR body

Mirror the repository's PR template if it has one. Otherwise:

```markdown
<one paragraph: what this delivers, for whom; links to the tracker issues>

## Issues
| Issue | What shipped |
| --- | --- |

## Decisions
Logged because they were made without a human in the loop (precedence: issue text > plan doc > design > smallest safe option).
**<theme>**
- <decision and reason>

## Migrations
<files, what they change, idempotency, how verification covers them; or "None">

## Ops notes
<new env vars, defaults, operational effects, removed endpoints; or "None">

## Tests
Final gate on `<sha>` (<environment notes>):
| Command | Result |
| --- | --- |
<every check with exact counts>

Reviews: <reviews run and that every finding was fixed or logged>
```

End the body with the session's attribution lines.

## Tracker

- Tick only the Done-when items that are met and verified. Never add progress logs to the description.
- Post a checkpoint per issue in the repository's format. If the repo ships an issue linter, lint each checkpoint file before posting. Typical sections: State, Done, Next, Verify so far (`- \`command\` — pass|fail|skipped|not run, detail`), Branch, Watch out.
- Set states: In Progress while you work; In Review with an open PR; Done only after the merge, or as the repository's rules say.

## Drive to green

- Subscribe to PR activity after creating the PR. Never poll with sleep.
- On red CI: read the job log. If the failure is this PR's, fix it, prove it locally, push. If it is infrastructure the diff does not touch (for example a runner that could not start a browser), comment once on the PR with the evidence and re-run the failed job once.
- Never skip, disable or quarantine a test; never push an empty commit or close and reopen to kick CI.
- Merge only when the user chose `pr+merge` at intake (or says so later), CI is green and the PR is mergeable. Pass the expected head SHA to the merge call.

## Final results

Produce what the user picked at intake (see the `report` skill): the chat icon list, tracker checkpoints, a shareable report page, or the PR body alone.
