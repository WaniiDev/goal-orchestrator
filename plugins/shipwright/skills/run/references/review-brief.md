# Review prompts

Reviewer and auditor rules live in their agent definitions. Send only these filled prompts. Each works in a throwaway worktree of the feature head: `git -C <repo> worktree add --detach <repo>/.claude/worktrees/<review-wave-1 | review-final | audit-<area>> <branch>`, removed when done. Leave out a line with nothing to say.

**Wave review**
```
Review wave <w>, read only. <throwaway worktree line>. Brief: <BRIEF.md>. Diff: git diff <head before the wave>..<head>.
Issues and Done-when:
- <issues>: <items>
Check these too:
- <issues>: no automated test proves this, so check it by hand: <untestable item>
- <issues>: the lane left a note: <OPEN line>
- <issues>: its pre-merge review noted: <finding>
- <issues>: changed files outside its own: <files>; check each change is needed
Later waves still build these, so don't report them as missing:
- <issues>: <items>
These lanes didn't ship, so don't report what only they would build: <id (issues)>.
```

**Final review**
```
Review the whole diff, read only. <throwaway worktree line>. Brief: <BRIEF.md>. Diff: git diff <base>..<head>.
Issues and Done-when (shipped lanes):
- <issues>: <items>
Also: check every Done-when item against code and tests; check cross-lane interactions on shared flows; re-run claimed results where cheap.
Earlier rounds fixed these; check each fix holds: <fixed findings>
Earlier rounds left these open; report each one that still holds again: <open findings>
No automated test proves these, so check each by hand: <untestable items>
These lanes didn't ship, so don't report what only they would build: <id (issues)>.
Left unmet because a lane they need didn't ship; don't report these: <blocked items>
<the last wave's lanes and any fix lanes, which no wave review saw: their untested items, notes and files outside their own, as in the wave review>
```

**UI audit** (one per area, at the final gate)
```
Audit <area | screens>, final. <throwaway worktree line, audit-<area>>. DB <db>, port <port>. Brief: <BRIEF.md>.
Design reference: <reference>. House standard: <standard>.   (or: No design reference: the Done-when items about the screen are the reference. At every size, all of it is visible, nothing is cut off or overlapping, and the layout is what the items say.)
Sizes and locales: <sizes, default desktop (1280×720) and phone (390×844)>.
Issues and Done-when: <shipped lanes' items>
```
