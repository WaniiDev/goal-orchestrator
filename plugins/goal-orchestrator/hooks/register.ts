import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ActiveGoal } from '../types'

const PLUGIN = 'goal-orchestrator'
/** `/goal`'s own limit on a condition. */
const MAX_CONDITION = 4000
/** `/goal clear` and its aliases. */
const CLEARS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

const goal = atom({ plugin: 'goal-orchestrator', key: 'goal' } as const, null as ActiveGoal | null)

const DESCRIPTION = [
  'Turns on Claude Code goal mode for a goal-orchestrator run: queues `/goal <condition>` exactly as if the person typed it.',
  'Call it once, at the end of the run skill\'s intake, with the finish line the person chose.',
  'The goal starts when this turn ends: after calling it, say in one line that goal mode is armed and end your turn.',
  'Write the condition so an evaluator that reads only the conversation can judge it: name each artefact and how it shows (PR merged into main, CI green, tracker issues Done, final report posted), and when to stop as impossible.',
].join(' ')

function conditionOf(input: unknown): string {
  const value = (input as { condition?: unknown }).condition
  return typeof value === 'string' ? value.trim() : ''
}

function runFileOf(input: unknown): string {
  const value = (input as { runFile?: unknown }).runFile
  return typeof value === 'string' ? value.trim() : ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'start_goal',
      description: DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          condition: { type: 'string', description: `The /goal completion condition, at most ${MAX_CONDITION} characters.` },
          runFile: { type: 'string', description: 'Absolute path of the run\'s RUN.md.' },
        },
        required: ['condition'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__goal-orchestrator__start_goal' }, async ($, e) => {
    const condition = conditionOf(e)
    if (condition === '') return { deny: `${PLUGIN}: start_goal needs a condition.` }
    if (condition.length > MAX_CONDITION) {
      return { deny: `${PLUGIN}: the condition is ${condition.length} characters; /goal takes at most ${MAX_CONDITION}.` }
    }
    const setAt = await $.clock.now()
    await update($, goal, () => ({ condition, runFile: runFileOf(e), setAt }))
    // A slash command cannot run inside the hook the turn is waiting on: queue it for when the session is idle.
    $.clock.after(0, () => {
      void $.command.run({ command: 'goal', args: condition }).catch(() => {
        $.ui.toast(`${PLUGIN}: /goal could not start. Type /goal and paste the condition from RUN.md.`)
      })
    })
    $.ui.status('goal mode queued')
    // A registered tool answers with text (or MCP content blocks): the shape core validates and the model reads.
    return {
      result: `Goal mode is queued: /goal starts when this turn ends and keeps the run going until this condition is met:\n${condition}\nEnd your turn now.`,
    }
  }).catch(() => ({ deny: `${PLUGIN}: start_goal failed; type /goal and paste the condition from RUN.md.` }))

  // `/goal clear` (or a new /goal for something else) ends this run's hold on the finish line.
  on('command.run', { command: 'goal' }, async ($, e, next) => {
    const args = e.args.trim()
    const current = await read($, goal)
    if (current !== null && args !== '' && (CLEARS.has(args.toLowerCase()) || args !== current.condition)) {
      await update($, goal, () => null)
      $.ui.status(undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Keeps the finish line in the system prompt, so it survives a compaction even if the conversation does not.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const current = await read($, goal)
    if (current === null) return composed
    const runFile = current.runFile === '' ? 'RUN.md in the scratchpad' : current.runFile
    const text = [
      'A goal-orchestrator run is active in this session, in goal mode.',
      `Its finish line (the /goal condition): ${current.condition}`,
      `Its state is in ${runFile}: re-read it before acting after a compaction or a resume, then continue the goal-orchestrator:run skill from the step it records.`,
      'If `/goal` reports the goal achieved or cleared, this section no longer applies.',
    ].join('\n')
    return { ...composed, sections: [...composed.sections, { id: `${PLUGIN}:finish-line`, text, scope: 'session' }] }
  })
}
