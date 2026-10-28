export type Outcome = 'DONE' | 'PARTIAL' | 'BLOCKED'

/** active: working · wrapup: a budget tripped, finish soon · ended: run_finish called · stopped: the watchdog ended it */
export type Phase = 'active' | 'wrapup' | 'ended' | 'stopped'

export type Limits = {
  maxHours: number
  maxIdleCalls: number
  maxSameFailure: number
  graceCalls: number
  maxQuietMinutes: number
}

export type Run = {
  branch: string
  repoDir: string
  startedAt: number
  lastActivityAt: number
  checkedAt: number
  head: string
  idleCalls: number
  failures: Record<string, number>
  quietWakes: number
  graceLeft: number
  phase: Phase
  reason: string
  outcome: Outcome | null
  summary: string
  limits: Limits
}

/** The finish line of the run this session is orchestrating, as `start_goal` set it. */
export type ActiveGoal = {
  /** The `/goal` condition, word for word. */
  condition: string
  /** Where the run keeps its state (`RUN.md`), so it can be re-read after a compaction. */
  runFile: string
  /** When the goal was queued, in epoch milliseconds. */
  setAt: number
}

/** wayfinder: chart the way · spec: write the spec · tickets: split it into tickets · ship is never stored: it hands over to the run. */
export type PlanStage = 'wayfinder' | 'spec' | 'tickets'

/** A plan `/shipwright:plan` is taking from an idea to tickets, as `plan_step` last moved it. */
export type ActivePlan = {
  stage: PlanStage
  /** The idea in the user's words, as the plan started. */
  goal: string
  /** The issue the stage works from (the map or the spec), once there is one. */
  issue: string
  /** Extra arguments for `/shipwright:run` (`--auto`). */
  runArgs: string
}

declare module 'claude-code' {
  interface PluginState {
    'shipwright': { run: Run | null; goal: ActiveGoal | null; plan: ActivePlan | null }
  }
}
