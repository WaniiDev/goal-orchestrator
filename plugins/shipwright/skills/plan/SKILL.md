---
name: plan
description: Take an idea in plain words to a spec and tickets on the issue tracker, then ship them as one PR. It chains /wayfinder, /to-spec and /to-tickets (the mattpocock-skills plugin), then compacts the session and starts /shipwright:run on the tickets.
when_to_use: The user runs /shipwright:plan, or asks to plan an idea into tickets and then ship it with shipwright.
argument-hint: "<the idea in plain words | a wayfinder map | a spec issue | a parent issue with tickets> [--auto]"
---

# Plan, then ship

Input: $ARGUMENTS

The chain: the idea → `/wayfinder` (the way to it) → `/to-spec` (a spec issue) → `/to-tickets` (sub-issues of the spec, each with acceptance criteria and blocking edges) → `/compact` → `/shipwright:run Implement <spec issue> and its sub-issues`. The run turns each ticket's acceptance criteria into Done-when items and its blocking edges into waves.

Those three skills are the user's own: only a typed command starts them. The `plan_step` tool types the next one for you when the turn ends, and the plugin keeps the plan's stage in your system prompt, so each step knows what comes after it.

## Start

1. The repo must have an issue tracker set up for those skills (`docs/agents/issue-tracker.md`). Without it, tell the user to run `/setup-matt-pocock-skills` first, and stop.
2. Load `mcp__shipwright__plan_step` with `ToolSearch` (`select:mcp__shipwright__plan_step`).
3. Find where the input starts, then call `plan_step` once, with `run_args: "--auto"` if the input has `--auto`:
   - The idea in plain words: `next: "wayfinder"`, `goal`: the idea, word for word.
   - A wayfinder map whose tickets are all closed: read the map and its Decisions so far, then `next: "spec"`, `goal`: the map's Destination, `issue`: the map.
   - A spec issue: `next: "tickets"`, `issue`: the spec.
   - A parent issue that already has its tickets: `next: "ship"`, `issue`: the parent.
4. Say in one line what runs next, then end your turn.

## Each stage

Follow the stage's own skill as it says, the user's checkpoints included: the grilling, the check of the test seams, the approval of the tickets. Never answer for the user. When the stage is done, call `plan_step` with the next stage, as the plan's section of your system prompt says, and end your turn.

`/shipwright-stop` ends a plan. `plan_step` with `next: "stop"` ends it too, when a stage cannot go on.
