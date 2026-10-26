# BRIEF.md template

Fill every `<…>` from recon and keep it under ~50 lines. It holds this repo's facts only: the generic rules live in the agent definitions, so don't repeat them here. Agents don't load CLAUDE.md files, so carry over every rule from the user's and the repo's CLAUDE.md that binds how code is built or checked.

```markdown
# Brief: <goal>
Feature branch: `<feature-branch>`.
Mode: <away: never ask; decide by issue > plan > design > repo docs/ADRs > smallest safe option, and list decisions | around: stop and report questions that change scope, architecture or data model>.

## Setup (in your worktree)
- Install: `<cmd>`. Add anything it creates that git doesn't ignore to `.git/info/exclude` (a linked `node_modules` slips past a `node_modules/` pattern).
- DB: set `<DATABASE_URL vars>` to the DB your task names (it ends in `_test`); prepare it with `<cmd>`.
- Port: `<PORT var>` = the port your task names. Browser: <notes>. Local config to copy and never commit: <files>.
- Merges and the final gate (in clean worktrees of the feature branch): DB `<db>`, port `<port>`.

## Checks (all of them before you finish)
- `<typecheck>` · `<typecheck tests>` · `<lint>` · `<unused-code>`
- Focused unit tests: `<cmd> <paths>` (don't export e2e-only flags such as `<FLAG>` for unit runs)
- e2e: `<cmd> <filter from your task>`
- Already failing on the base (don't fix, don't re-prove): <list | none>

## Invariants
<the repo's rules, e.g. auth → authorize → validate → DB; schema and its verification aligned; realtime publish inside the write's transaction; UI only from design-system tokens; all locale files together; size caps; naming>

## Docs to update when behaviour changes
<behaviour area → owning doc>

## Commit message
`<imperative summary> (<ISSUE>)`, a blank line, then:
<attribution trailers>

## Read only if your lane touches it
<doc → when it matters>
```
