# Review and audit briefs

Reviewers never fix code. They return findings as text; you save them to the scratchpad and turn them into fix lanes. Give each reviewer a fresh worktree created from the feature branch head (`git worktree add -b review-<n> <path> <feature-branch>`), its own DB and port if it must run the app, and these instructions.

## Wave review (after each wave)

```
Work only in <worktree> (on <feature-branch> at <sha>). Review the diff of this wave: `git diff <sha-before-wave>..HEAD`. Issues in this wave and their Done-when items: <list>. Repo rules: <steering files>.
Find, verify and rank:
- correctness bugs (state, races, stale closures, error paths, transactions, idempotency), data integrity, security (authn/authz, input validation, secrets in logs),
- invariant violations (<list>), tests that assert nothing or were weakened, missing tests for Done-when items,
- docs that now say something false.
For each finding: severity (must-fix / should-fix / nit), file:line, a concrete failure scenario (inputs → wrong result), and the fix. Verify by reading the code and, where cheap, a focused test or probe. Do not report what you could not substantiate. Final message: the ranked list, then the checks you ran.
```

## Final whole-diff review

Same as the wave review, over `git diff <base>..HEAD`, plus: every Done-when item of every issue, checked against code and tests; cross-lane interactions (two lanes that changed the same flow); the PR's claimed test results re-run where cheap. For UI goals, add a visual re-verification of every earlier finding (status fixed / partly / not fixed with evidence).

## UI audit (one per area: list screens, dialogs and drawers, motion)

```
Compare the built screens with the design reference <folder, boards> and the house standard <design doc, ADRs, design-system folders>. Run the app (own DB <db>, port <port>), seed realistic varied data through the API, and take real screenshots of each state at the reference sizes (desktop and phone, every locale that matters). Render the reference boards in the browser at their sizes and compare side by side. For motion, capture frame strips or per-frame samples (and running animations) of each moving thing: enter, leave, interrupt, live updates, reduced motion.
Return findings: severity, where (file:line + screen/state), reference (board element or quoted rule), now (screenshot path), fix (named components, tokens, presets; or "listed deviation" with reason). Group by screen; end with the top 10 most visible. Do not report what matches.
```
