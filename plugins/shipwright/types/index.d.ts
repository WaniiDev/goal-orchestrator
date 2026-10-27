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

declare module 'claude-code' {
  interface PluginState {
    'shipwright': { run: Run | null; goal: ActiveGoal | null }
  }
}
