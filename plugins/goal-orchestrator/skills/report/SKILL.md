---
name: report
description: Produce the final results of a goal-orchestrator run in the forms the user chose at intake (chat icon list, tracker checkpoints, a shareable report page, or the PR body alone). Use at the end of a run, or when the user asks for the final results.
when_to_use: A goal-orchestrator run has finished (merged, PR open, or branch pushed), or the user asks for "final results", "the report" or runs /goal-orchestrator:report.
---

Read `RUN.md` (the `results:` line), `DECISIONS.md`, the gate results and the PR. Produce each chosen form, and only those.

## Chat summary (always, when `chat` was chosen)

Lead with the outcome in one line (merged as `<sha>` / PR #<n> green and waiting / branch pushed), then:

```
✅ done · ⚠️ needs you

**Shipped**
- ✅ <ID> <what shipped, a few words>

**Checks** (on <sha>)
- ✅ typecheck, lint, unused code
- ✅ unit + integration: <n> pass, 0 fail
- ✅ e2e: <n> passed
- ✅ CI: <checks>

**Reviews**
- ✅ <n> review rounds; <n> findings fixed, <n> logged as decisions

**Tracker**
- ✅ <IDs> Done, checkpoints posted

**Decisions** (top 3–5; full list in the PR)
- <decision>

⚠️ <open follow-ups, flaky tests root-caused or not, anything the user must do>
```

## Tracker checkpoint (`tracker`)

For each issue: tick verified Done-when boxes, post the checkpoint in the repository's format (lint it first if the repo ships a linter), set the final state. Link the PR.

## Shareable report page (`page`)

Publish a private Artifact page (load the artifact-design skill first): title "<goal> — results"; sections: Outcome (status, PR link, merge SHA), What shipped (per issue), Decisions (grouped), Checks (table with exact commands and counts), Reviews and findings (counts per round, notable fixes), Evidence (screenshots or timings if the run produced them), Follow-ups. Give the user the link.

## PR body only (`pr-body`)

Make sure the PR description carries Issues, Decisions, Migrations, Ops notes and Tests with the final numbers; update it if the gate ran after the PR was opened.
