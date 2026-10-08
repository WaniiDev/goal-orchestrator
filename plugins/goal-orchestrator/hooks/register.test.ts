import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__goal-orchestrator__start_goal'
const COMPOSE = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const CONDITION = 'PR for WAN-1 is merged into main with CI green, WAN-1 is Done with a checkpoint, and the final report is posted.'

/** The engine beneath the plugin: a system prompt with no sections of its own, and /goal recorded. */
function engine(on: On) {
  const runs: string[] = []
  on('prompt.compose', () => ({ sections: [] }))
  on('command.run', { command: 'goal' }, (_$, e) => {
    runs.push(e.args)
    return { text: '' }
  })
  return runs
}

test('start_goal queues /goal with the condition once the turn is over', async ($, on) => {
  const clock = mock.clock(on)
  const runs = engine(on)

  const called = await $.tool.call({ tool: TOOL, condition: CONDITION, runFile: '/tmp/RUN.md' })
  expect(called.deny).toBeUndefined()
  expect(runs).toEqual([])

  await clock.settle()
  expect(runs).toEqual([CONDITION])
})

test('the finish line rides the system prompt until /goal is cleared', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])

  await $.tool.call({ tool: TOOL, condition: CONDITION, runFile: '/tmp/RUN.md' })
  await clock.settle()
  const [section] = (await $.prompt.compose(COMPOSE)).sections
  expect(section?.id).toBe('goal-orchestrator:finish-line')
  expect(section?.text).toContain(CONDITION)
  expect(section?.text).toContain('/tmp/RUN.md')

  // The engine stamps origin and presentation on a run; the test's call leaves them to it.
  await $.command.run({ command: 'goal', args: 'clear' } as Parameters<typeof $.command.run>[0])
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])
})

test('start_goal refuses an empty or oversized condition and queues nothing', async ($, on) => {
  const clock = mock.clock(on)
  const runs = engine(on)

  const empty = await $.tool.call({ tool: TOOL, condition: '  ' })
  expect(empty.deny).toContain('needs a condition')
  const long = await $.tool.call({ tool: TOOL, condition: 'x'.repeat(4001) })
  expect(long.deny).toContain('at most 4000')

  await clock.settle()
  expect(runs).toEqual([])
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])
})
