# Ship

You drive the build: sub-agents build and review, and you check, merge and decide. Load `SendMessage` and `TaskStop` with one `ToolSearch` (`select:SendMessage,TaskStop`). Prompts for reviews and audits: [review prompts](review-brief.md).

Every agent runs in the background (its definition says so), with `model` and `effort` from the plan (a lane's own override `models.implementer`). While agents run, end your turn with the line `Waiting for the lanes.`; each result arrives as a notification. A goal check-in or the watchdog's quiet-run notice before then gets the same line and no tool calls. Never poll, and never do an agent's work yourself.

**Lanes table.** Keep one row per lane in `RUN.md`, fix lanes included, and update it on every change: `id | wave | agent name | status (contract, building, retry <n>, waiting <id>, merged <sha>, dropped) | why`. Save each agent's report to `reports/<agent name>.md` and keep one verdict line in context.

## A wave

### 1. Contract

When the plan has `contract` on and the wave has code lanes. Wave 1's starts after the plan; each later wave's is written while the wave before it is reviewed. Launch `shipwright:implementer` named `contract-<w>`:
```
Write the acceptance contract for wave <w>. Main checkout <repo>, feature branch <branch>. Brief: <BRIEF.md>.
Work in a throwaway worktree: git -C <repo> worktree add -b contract-wave-<w> <repo>/.claude/worktrees/contract-wave-<w> <branch>. For each Done-when item below that an automated test can prove, write a failing acceptance test in the repo's test layout, in new files of each lane's own, named so the lane's own test files stay free (for example <module>.contract.test.ts) and so the lane's e2e filter, where it has one, matches its e2e files. Write them as ordinary tests: import what the lane will create the way the code will use it, with no dynamic imports, type copies or any-casts. Import only the lane's own files and code already on the branch, and build by hand any state another lane's code would make, so no lane waits for another. Scope every UI query to the lane's own part of the screen and its own test data: never assert a page-wide count or that an element is the only one of its role. Run them and confirm each fails only because the feature is missing (a missing module or export counts; an error in the tests themselves doesn't). If the branch has no test runner yet, don't install one: say so in a NOTE. Write no feature code and change no config.
<if lanes didn't ship: These earlier lanes didn't ship: <id (issues)>. Write no test for an item that needs their work; list it as untestable with why "needs <lane id>".>
Commit the tests on contract-wave-<w> as one commit ("Add acceptance tests for wave <w>"). Don't push. Remove the worktree and keep the branch.
Report, under each lane's id:
CONTRACT <sha | none>
FILES <lane id>: <path>, …
UNTESTABLE <lane id>: <Done-when item> — <why>      (one line each)
NOTE <lane id>: <what the lane should know, such as the API the tests expect>
Lane <id> (<issues>), will own <owns>[, e2e filter <filter>]:
- <Done-when item>
```
No answer, or no entry for a lane: that lane builds without contract tests; say so in `DECISIONS.md`.

### 2. Lanes

For each lane: `git worktree add -b lane-<id> <repo>/.claude/worktrees/lane-<id> <branch>` (not `isolation: "worktree"`: it branches from the default branch), and copy in any untracked local config the brief lists. Launch `shipwright:implementer` named `lane-<id>`:
```
Lane <id>: <issues>. Main checkout <repo>, feature branch <branch>. Brief: <BRIEF.md>. Mode: <away | around>.
Worktree <repo>/.claude/worktrees/lane-<id>, branch lane-<id>.
Done when:
1. <item>
Own: <owns>, with their tests. Don't touch: <avoid>.
<others building: Building alongside you: <id (owns)>; …. If you can't finish without one of them, report blocked with its id in NEEDS.>
DB <db>, port <port>. e2e filter: <filter>.
Report at least these checks: <fast checks>.
<contract: Contract tests: first bring in your own with git checkout <contract sha> -- <files> and commit them ("Add acceptance tests for <issues>"). Make them pass and never edit them.>
<notes: From the contract's writer: <notes>>
<answers: The user's answers: <answers>>
<lanes didn't ship: These earlier lanes didn't ship: <id (issues)>. Report a Done-when item that can't be met without one of them as not met, with proof starting "needs <lane id>"; meet the rest.>
<fix lane: A finding you judge wrong, or not fixable within these files, may stay: report it not met with proof starting "won't fix:" and why. Fix the rest.>
A check that fails only in tests outside your files, which fail the same way on <branch> without your change: report it fail foreign.
```

### 3. When a lane reports

Its gaps, first from the report:
- a Done-when item not met, unless its proof starts `needs <id>` for a lane that didn't ship, or `won't fix:` in a fix lane (these are **waived**);
- a failing check not marked `foreign`; a code lane with no checks;
- status `partial`, with its OPEN lines.

`blocked` with NEEDS naming a lane of this wave still building: mark it `waiting <id>`; when that lane merges, `SendMessage` it: "<id> merged into <branch>: git merge <branch>, then finish and report again." Any other `blocked` (a secret, a service, a lane that won't merge): drop it, no retry. Every Done-when item waived: drop it, no retry. Around mode, QUESTIONS: ask the user, then send the answers to the same agent.

No gaps in the report: check it yourself, in one Bash call in its worktree:
- `git status --porcelain` prints nothing;
- the contract tests are untouched: `git diff --quiet <contract sha> HEAD -- <files>`;
- `git diff --name-only <branch>...HEAD`: a file another lane of this wave owns is a gap; any other file outside its own goes to the wave review;
- re-run the fast checks and its contract tests (`cmd > <log> 2>&1; echo "exit=$?"`, then the summary line), and compare the counts with the report. A failure only in tests outside the lane: run them on `<branch>` in a throwaway worktree (`git worktree add --detach <repo>/.claude/worktrees/base-<id> <branch>`, removed after). Failing the same way there, it is **foreign**: list it for the final gate, not against the lane.

A high-risk lane (`risk: "high"`) while other lanes of its wave still build: launch `shipwright:reviewer` named `review-<id>` on its worktree, read only, diff `git diff <branch>...lane-<id>`, with its Done-when items. Its must and security findings are gaps; the rest go to the wave review.

Gaps: `SendMessage` to `lane-<id>`: "These gaps remain. Close each one, commit, and report again in the same format:" and the list. At most 2 retries. After that, drop the lane with the first gap as why, except one whose only gaps are its pre-merge review's findings: it merges, and those findings go to the wave's fix lanes.

### 4. Merge

Merge each lane as soon as it is ready; don't wait for the rest of the wave. In the main checkout: `git merge --no-ff lane-<id> -m "Merge <issues>: <summary>"` plus the brief's trailers; resolve a conflict per hunk, keeping both sides' intent, else `git merge --abort` and treat it as a gap. Then run the fast checks in a clean worktree of the new head (`git worktree add --detach <repo>/.claude/worktrees/check-<n> HEAD`, removed after), not in the main checkout, whose test runner would pick up the lane worktrees. Fix only what the merge broke, as its own commit. Push (unless `"push": false`), `git worktree remove` the lane's worktree, and keep its branch. Note the merged sha in the lanes table, and its untestable and waived items in `RUN.md`.

### 5. Review the wave

When every lane of the wave has merged or dropped. Skip it for a wave with no code lane merged, and for a one-wave plan (the whole-diff review covers it). Launch one `shipwright:reviewer` named `review-wave-<w>` with the wave prompt, and the next wave's contract at the same time. No UI audits here: the screens are audited once, at the final gate.

Its `must` and security findings, plus any a high-risk lane merged with, become **fix lanes**: group findings that share a file (a source file and its tests count as one), at most 4 lanes, each owning the files its findings name, its Done-when items the findings (`<severity> <file>:<line> — <problem> — fix: <fix>`), its id `w<w>-fix<n>`. They run like lanes, without a contract. A fix lane that no next-wave lane overlaps builds alongside the next wave; one that does merges first. `should` findings stay open for the whole-diff review; nits are listed in the results. A merged fix lane closes its findings, except those it left with `won't fix:`.

Then the next wave, once its contract is in.

## Final gate

After the last wave and its fix lanes. If the base moved, merge it in first (prefer that to rebasing). In a clean worktree of the head (`check-gate-<n>`), run every gate command in the background and record exact counts in `RUN.md`. Each failure (the failing tests, the likely cause, the files) becomes a `must` fix lane; at most 2 fix rounds, and stop early when no fix merges. A flaky test is root-caused, and its fix proven with about 10 repeats.

Green: launch the whole-diff review and, with `ui` in the plan, one `shipwright:ui-auditor` per area (one for every screen when there are no areas), all at once, with the final prompts. Every actionable finding (`must` and `should`; security nits too) becomes a fix lane. The whole-diff review judges every earlier open finding again, so what it leaves open replaces them. If any fix merged, run the gate once more.

## Result

Write `reports/ship.json` (the report skill and delivery read it):
```json
{
  "outcome": "DONE | PARTIAL | BLOCKED",
  "head": "<sha>",
  "shipped": [{ "id": "", "issues": [] }],
  "notShipped": [{ "id": "", "issues": [], "why": "" }],
  "lanes": [{ "id": "", "round": "wave 1 | w1-fix | gate 1 | final", "status": "merged | dropped", "attempts": 1, "decisions": [], "notes": [], "outside": [] }],
  "untestable": ["<issues>: <item> (<why>)"],
  "blocked": ["<issues>: <item> (needs <lane>)"],
  "foreign": ["<lane>: <cmd> (<counts>)"],
  "reviews": [{ "round": "wave 1 | final", "findings": 0, "actionable": 0, "open": 0, "nits": [] }],
  "gate": { "green": true, "checks": [{ "cmd": "", "pass": true, "counts": "" }], "failures": [{ "problem": "", "files": [] }] },
  "fixed": [], "open": [], "security": [],
  "tokens": 0,
  "leftover": ["<worktree paths of lanes that never merged>"]
}
```
- `outcome`: `BLOCKED` when nothing shipped; `DONE` when every planned lane shipped, the gate is green and no `must` or security finding is open; else `PARTIAL`.
- `gate.failures`: a red gate's failures, or a green gate's open `must` and security findings.
- `open`: each problem once (the same file, a source file and its tests as one, and lines within 5), keeping the most severe; `security` is the open ones with `security`.
- `tokens`: the sum of `total_tokens` over every agent's result; `null` if a result didn't report it.

## Resume and stop

- After a compaction, the lanes table says where each lane is; finish the step it records.
- After the session restarted (its agents are gone; a lane's last report never came): for each lane still `building` or `retry`, launch a new implementer with the same name and prompt, plus "Your worktree has your earlier commits: continue from them." Relaunch a lost review or contract the same way.
- The watchdog's wrap-up notice: `TaskStop` each running agent, then go to delivery with what merged, as `PARTIAL`.
