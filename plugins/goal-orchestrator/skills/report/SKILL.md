---
name: report
description: Produce a finished goal-orchestrator run's final results in the forms chosen at intake.
disable-model-invocation: true
---

Read `RUN.md` (the `results:` line), `DECISIONS.md`, the gate results and the PR. Produce only the forms chosen there. `pr-body` and `tracker` follow the run skill's `references/delivery.md`.

**chat**: lead with one line on the outcome (merged as `<sha>` / PR #<n> green, waiting for you / branch pushed / the `GOAL:` line). Then:
```
✅ done · ⚠️ needs you

**Shipped**
- ✅ <ID> <what shipped>
**Checks** (on <sha>)
- ✅ typecheck, lint, unused code
- ✅ unit + integration: <n> pass, 0 fail · e2e: <n> passed · CI: <checks>
**Reviews**
- ✅ <n> rounds; <n> findings fixed, <n> logged as decisions
**Decisions** (top 3–5; full list in the PR)
- <decision>

⚠️ <follow-ups, unresolved flaky tests, anything the user must do>
```

**page**: make a private Artifact titled "<goal> results", following the Artifact tool's own steps (quickstart first), with these sections: Outcome (status, PR link, merge SHA), What shipped (per issue), Decisions (grouped), Checks (exact commands and counts), Reviews (counts per round, notable fixes), Evidence (screenshots and timings, if any), Follow-ups.
