# Review prompts

Reviewer and auditor rules live in their agent definitions. Send only these filled prompts, each with a fresh worktree from the feature head (`git worktree add -b review-<n> <path> <feature-branch>`).

**Wave review**
```
Worktree <path> on <feature-branch>@<sha>. Brief: <BRIEF.md>. Diff: git diff <sha-before-wave>..HEAD.
Issues and Done-when: <list>.
```

**Final review**
```
Worktree <path> on <feature-branch>@<sha>. Brief: <BRIEF.md>. Diff: git diff <base>..HEAD.
All issues and Done-when: <list>.
Also: check every Done-when item against code and tests; check cross-lane interactions on shared flows; re-run the PR's claimed results where cheap.
<UI goals: re-verify every earlier UI finding as fixed / partly / not, with evidence.>
```

**UI audit** (one per area)
```
Worktree <path>, DB <db>, port <port>. Area: <lists | dialogs and drawers | motion>.
Design reference: <folder, boards>. House standard: <design doc, ADRs, design-system folder>. Sizes and locales: <…>.
```
