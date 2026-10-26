# Intake

Ask with **one** `AskUserQuestion` call before any other tool call. Put the recommended option first. The user can always type "Other" (for example `opus · max` or a full model ID).

1. header `Build with`: "Which model and effort should the implementer agents use?"
   `Sonnet · medium (Recommended)` (well-specified issues) · `Opus · high` (hard refactors, data integrity, concurrency) · `Fable · medium` · `Haiku · low` (only renames, copy, docs)
2. header `Review with`: "Which model and effort should the review and audit agents use?"
   `Opus · xhigh (Recommended)` · `Opus · high` · `Sonnet · high` (small goals) · `Same as implementers`
3. header `You`: "Will you be around while this runs?"
   `Away / asleep (Recommended for long goals)`: no questions after this; decisions go in the PR · `Around`: asked only about what changes what gets built
4. header `Finish`: "How far should I take it?"
   `PR, merge when green (Recommended)` · `PR, I merge` · `Branch only`

The final results default to the chat summary, the PR body and tracker checkpoints (only when a tracker connector exists). Add the shareable report page only if the goal asks for one.

Write to `RUN.md`:
```
goal: <text or issue keys>
implementer: model=<alias|id> effort=<low|medium|high|xhigh|max>
reviewer: model=<…> effort=<…>
mode: away | around
finish: branch | pr | pr+merge
results: chat, pr-body[, tracker][, page]
branch: <feature branch>
started: <ISO time>
```
These answers are the user's explicit choice of models and efforts: they go into the plan's `models` (without workflows: `model` and `effort` on every `Agent` call).

**Skip the question** with `--auto`, or when the goal already answers it. Then use the stated values, or these defaults: implementer `sonnet · medium`, reviewer `opus · xhigh`, mode `away`, finish `pr` (never merge without an explicit yes). Say in one line which values you used.
