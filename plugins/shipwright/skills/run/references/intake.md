# Intake

Ask with **two** `AskUserQuestion` calls, the second right after the first is answered. Before them, only read this file and run `git remote get-url origin` (for question 4). Put the recommended option first. The user can always type "Other" (for example `opus · max` or a full model ID).

## First call: who builds it and where it ends

1. header `Build with`: "Which model and effort should the implementer agents use?"
   `Sonnet · medium (Recommended)` (well-specified issues) · `Opus · high` (hard refactors, data integrity, concurrency) · `Fable · medium` · `Haiku · low` (only renames, copy, docs)
2. header `Review with`: "Which model and effort should the review and audit agents use?"
   `Opus · xhigh (Recommended)` · `Opus · high` · `Sonnet · high` (small goals) · `Same as implementers`
3. header `You`: "Will you be around while this runs?"
   `Away / asleep (Recommended for long goals)`: no questions after this; decisions go in the PR · `Around`: asked only about what changes what gets built
4. header `Finish`: "How far should I take it?"
   `PR, merge when green (Recommended)` · `PR, I merge` · `Branch only`
   No PR host (no origin, or origin is a local path or a `file://` URL): recommend `Branch only` instead, and say in each PR option that it ends `BLOCKED` here.

## Second call: how it runs

5. header `How to run`, `multiSelect: true`: "Which should the run do? Pick every one you want (Recommended: all four)."
   `In one go`: no stops between steps · `Parallel lanes`: as many lanes per wave as have disjoint files; left out, one lane per wave · `Update issues along the way`: In Progress, checkpoints, In Review, Done (wherever the issues live) · `Contract tests first`: failing acceptance tests before any feature code
   The picked ones are on and the rest off; an empty answer keeps all four on.
6. header `Time`: "How long may the run take before it wraps up?"
   `8 h (Recommended)` · `4 h` · `12 h`
7. header `Results`: "Which final results do you want?"
   `Chat and PR body (Recommended)`: plus tracker checkpoints when the issues live in a tracker · `Also a report page`: a private, shareable Artifact
8. header `UI checks`, only when the goal's words name screens, pages or UI: "How should the built screens be checked?"
   `Desktop and phone (Recommended)`: screenshots at 1280×720 and 390×844 · `Desktop only` · `Skip`: no UI audits
   Without it, recon decides: a goal with screens gets both sizes.

## RUN.md

```
goal: <text or issue keys>
implementer: model=<alias|id> effort=<low|medium|high|xhigh|max>
reviewer: model=<…> effort=<…>
mode: away | around
finish: branch | pr | pr+merge
defaults: one go, parallel, tracker updates, contract   (only what is on)
budget: <hours>h
results: chat, pr-body[, tracker][, page]
ui: both | desktop | skip
branch: <feature branch>
started: <ISO time>
```
Where each answer goes:
- The models are the user's explicit choice: the plan's `models` (without workflows: `model` and `effort` on every `Agent` call).
- `defaults`: [the run skill](../SKILL.md)'s "Every run" rules for one go, parallel and tracker updates; without `contract`, the plan's `"contract": false`.
- `budget`: `run_start`'s `max_hours`.
- `ui`: the plan's `ui.sizes` (`desktop 1280×720` for desktop only); `skip` leaves `ui` out of the plan.

**Skip the intake** with `--auto`. Skip a single question when the words the user typed answer it (a plan doc isn't read until recon), not when you could guess the answer; skip the second call when they answer all of it. Then use the stated values, or these defaults: models chosen per lane after recon (run Step 2, "Models per lane"), mode `away`, finish `pr` (`branch` with no PR host; never merge without an explicit yes), all four ways of running on, `8h`, results chat and PR body, UI checks at both sizes. Say in one line which values you used.
