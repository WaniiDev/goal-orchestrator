---
name: report
description: Produce a finished goal-orchestrator run's final results in the forms chosen at intake.
disable-model-invocation: true
---

Read `RUN.md` (the `results:` line), `DECISIONS.md`, `reports/ship.json` (the workflow's result) and the PR. Produce only the forms chosen there. `pr-body` and `tracker` follow the run skill's `references/delivery.md`.

**chat**: lead with one line on the outcome (merged as `<sha>` / PR #<n> green, waiting for you / branch pushed / the `GOAL:` line). Then:
```
✅ done · ⚠️ needs you

**Shipped**
- ✅ <ID> <what shipped>
**Checks** (on <sha>)
- ✅ typecheck, lint, unused code
- ✅ unit + integration: <n> pass, 0 fail · e2e: <n> passed · CI: <checks>
**Reviews**
- ✅ <n> rounds; <n> findings fixed (`fixed`), <n> open (`open`), <n> nits (`reviews[].nits`)
**Decisions** (top 3–5; full list in the PR)
- <decision>

⚠️ <follow-ups, unresolved flaky tests, anything the user must do>
```
Every ✅ stands on a result in `reports/ship.json` or the PR's checks; a check that didn't run, or a claim nobody re-checked, is ⚠️ with the reason.

**page**: make a private Artifact titled "<goal> results", following the Artifact tool's own steps (quickstart first), with these sections: Outcome (status, PR link, merge SHA), What shipped (per issue), Decisions (grouped), Checks (exact commands and counts), Reviews (counts per round, notable fixes), Evidence (screenshots and timings, if any), Follow-ups.
