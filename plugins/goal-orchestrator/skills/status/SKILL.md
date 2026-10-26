---
name: status
description: Show a goal-orchestrator run's progress as a compact icon list.
disable-model-invocation: true
---

Answer from `RUN.md`, the task list, the ship workflow's journal (`journal.jsonl` in the transcript folder `RUN.md` names: one line per finished agent), the merges, the checks and the PR. An agent still running is 🔄; never guess its result. No prose, no preamble.

```
✅ done · 🔄 running · ⏳ waiting · ❌ failed · ⚠️ needs you

**Waves** (or **Issues**)
- ✅ <ID> <a few words>
**Reviews**
- ✅ Wave 1: <n> findings, all fixed
**Checks**
- ✅ unit + integration: <pass> pass, <fail> fail
**PR**
- ⏳ not opened   (or ✅ #<n> green, mergeable)

⚠️ <one line per thing the user must act on>
```
One line per item; key numbers only; leave out empty groups; ⚠️ lines only when something needs the user.
