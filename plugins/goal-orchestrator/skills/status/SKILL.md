---
name: status
description: Report an orchestrated goal's progress as a compact icon list (legend, grouped one-line items, key numbers, ⚠️ lines for anything needing the user). Use when the user asks for progress, status or "where are we" during a goal-orchestrator run.
when_to_use: The user asks "progress", "status", "where are we" while a goal-orchestrator run is going, or runs /goal-orchestrator:status.
---

Answer from what you know: `RUN.md`, the task list, the agents you launched, merges, checks and the PR. Never guess an agent's result: one still running is 🔄.

Format (no prose, no preamble):

```
✅ done · 🔄 running · ⏳ waiting · ❌ failed

**Issues** (or **Waves**)
- ✅ <ID> <a few words on what it is>
- 🔄 <ID> <a few words>

**Reviews**
- ✅ Wave 1 review: <n> findings, all fixed

**Checks**
- ✅ typecheck, lint, unused code
- ✅ unit + integration: <pass> pass, <fail> fail
- 🔄 full e2e

**Tracker**
- ⏳ <ID> checkpoint after the gate

**PR**
- ⏳ not opened yet   (or ✅ #<n> green, mergeable)

⚠️ <one line per thing the user must act on>
```

Rules: one line per item; key numbers only (test counts, pass/fail, timings when they matter); group under short bold headings that fit the run; leave out empty groups; end with ⚠️ lines only when something needs the user.
