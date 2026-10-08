# Intake

Ask before any other tool call. Use `AskUserQuestion` with these four questions in **one** call (the tool takes up to four). Put the recommended option first, labelled "(Recommended)". The user can always type "Other" (for example `opus · max` or a full model ID).

## Call 1 (always)

1. **Implementers**. header `Build with`. question "Which model and effort should the implementer agents use for this long task?"
   - `Sonnet · medium (Recommended)`: fast and economical; good for well-specified issues.
   - `Opus · high`: for hard refactors, data-integrity or concurrency work.
   - `Fable · medium`: alternative general model.
   - `Haiku · low`: only for mechanical changes (renames, copy, docs).
2. **Reviewers**. header `Review with`. question "Which model and effort should the review and audit agents use?"
   - `Opus · xhigh (Recommended)`: deep review after every wave and on the whole diff.
   - `Opus · high`: a little faster.
   - `Sonnet · high`: economical review for small goals.
   - `Same as implementers`
3. **Availability**. header `You`. question "Will you be around while this runs?"
   - `Away / asleep (Recommended for long goals)`: fully autonomous. No questions after this; every decision is logged in the PR's Decisions section.
   - `Around`: you are asked only for decisions that change what gets built.
4. **Finish line**. header `Finish`. question "How far should I take it?"
   - `PR, merge when green (Recommended)`: open the PR, drive CI to green, merge with a merge commit, close the tracker issues.
   - `PR, I merge`: open the PR and drive it to green; you merge.
   - `Branch only`: push the branch, no PR.

## Call 2 (always; multiSelect)

5. **Final results**. header `Results`. question "What do you want at the end?" (multiSelect: true)
   - `Chat summary (icon list)`: the compact icon-list report in the session.
   - `Tracker checkpoint`: Done-when boxes ticked and a checkpoint comment on each issue.
   - `Shareable report page`: a private HTML report (Artifact) with what shipped, decisions, checks and evidence, ready to share.
   - `PR body only`: everything lives in the PR description.

If the session has no tracker connector, drop `Tracker checkpoint`. If it has no Artifact tool, drop `Shareable report page`.

## Recording

Write the answers to `RUN.md`:

```
goal: <text or issue keys>
implementer: model=<alias|id> effort=<low|medium|high|xhigh|max>
reviewer: model=<alias|id> effort=<...>
mode: away | around
finish: branch | pr | pr+merge
results: chat, tracker, page, pr-body
branch: <feature branch>
started: <ISO time>
```

The user's choices here count as their explicit request for those models and efforts. Pass them on every `Agent` call as `model` and `effort`.

## `--auto` and goals that already answer

With `--auto`, or when the goal text already states the values, skip the questions and use the stated values, or these defaults: implementer `sonnet · medium`, reviewer `opus · xhigh`, mode `away`, finish `pr` (never merge without an explicit yes), results `chat, tracker, pr-body`. Say in one line which values you used.
