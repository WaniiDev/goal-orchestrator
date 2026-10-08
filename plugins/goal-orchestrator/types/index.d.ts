/** The finish line of the run this session is orchestrating, as `start_goal` set it. */
export type ActiveGoal = {
  /** The `/goal` condition, word for word. */
  condition: string;
  /** Where the run keeps its state (`RUN.md`), so it can be re-read after a compaction. */
  runFile: string;
  /** When the goal was queued, in epoch milliseconds. */
  setAt: number;
};

declare module 'claude-code' {
  interface PluginState {
    'goal-orchestrator': { goal: ActiveGoal | null };
  }
}
