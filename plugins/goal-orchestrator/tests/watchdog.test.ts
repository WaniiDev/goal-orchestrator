import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'

const START = 'mcp__goal-orchestrator__run_start'
const FINISH = 'mcp__goal-orchestrator__run_finish'
const START_GOAL = 'mcp__goal-orchestrator__start_goal'
const COMPOSE = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const TRANSCRIPT: SessionMessage[] = [{ role: 'user', text: 'ship WAN-1', toolUses: [] }]
const BAND = {
  plugin: 'goal-orchestrator',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const
const CONDITION = 'goal-orchestrator run for WAN-1. Met when the latest reply ends with a line starting "GOAL: DONE", "GOAL: PARTIAL" or "GOAL: BLOCKED".'

type World = { heads: string[]; goals: string[]; goalClears: number; prompts: string[]; toasts: string[]; failing: Set<string> }

// The world beneath the plugin: git, the UI, /goal, prompts and the tools themselves.
function world(on: On): World {
  const w: World = { heads: ['aaa'], goals: [], goalClears: 0, prompts: [], toasts: [], failing: new Set() }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: `${w.heads[0]}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'goal' }, ($, e) => {
    w.goals.push(e.args)
    if (e.args === 'clear') w.goalClears += 1
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', ($, e) => {
    const command = e.tool === 'Bash' ? e.command : ''
    return (w.failing.has(command) ? { result: 'boom', isError: true } : { result: 'ok' }) as never
  })
  return w
}

async function begin($: Engine, limits: Record<string, number> = {}) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  return $.tool.call({ tool: START, branch: 'feat/x', repo_dir: '/repo', ...limits } as never)
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

const mainTurnEnds = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

describe('goal-orchestrator watchdog', () => {
  test('guards apply only while a run is active', async ($, on) => {
    mock.clock(on)
    world(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
    expect((await bash($, 'pkill -f vite')).deny).toBeUndefined()

    await begin($)
    expect((await bash($, 'pkill -f vite')).deny).toMatch(/kill only PIDs/)
    expect((await bash($, 'git push --force origin feat/x')).deny).toMatch(/force push/)
    expect((await bash($, 'git push --force-with-lease origin lane-1')).deny).toBeUndefined()
    expect((await bash($, 'git commit --no-verify -m x')).deny).toMatch(/git hooks/)
    expect((await bash($, 'bun test')).deny).toBeUndefined()
  })

  test('run_finish ends the run, locks tools, then clears /goal at turn end', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await begin($)
    const finished = await $.tool.call({ tool: FINISH, outcome: 'BLOCKED', summary: 'CI secret missing', user_action: 'add NPM_TOKEN' } as never)
    expect(String(finished.result)).toContain('GOAL: BLOCKED — CI secret missing; you must: add NPM_TOKEN')

    expect((await bash($, 'bun test')).deny).toMatch(/run is over/)
    expect((await $.tool.call({ tool: 'TaskStop', task_id: 'x' } as never)).deny).toBeUndefined()

    await mainTurnEnds($)
    await clock.advance(1)
    expect(w.goalClears).toBe(1)
    expect((await bash($, 'pkill -f vite')).deny).toBeUndefined()
  })

  test('the same failure trips wrap-up, then a hard stop clears /goal', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await begin($, { max_same_failure: 2 })
    w.failing.add('bun test')
    await bash($, 'bun test')
    const tripped = await bash($, 'bun test')
    expect(tripped.context?.join(' ')).toMatch(/watchdog: "bun test" failed 2 times/)

    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x' } as never)).deny).toMatch(/No new agents/)
    expect((await $.tool.call({ tool: 'Workflow', name: 'goal-orchestrator:ship' } as never)).deny).toMatch(/No new agents or workflows/)
    let last = await bash($, 'git status')
    for (let i = 0; i < 20 && last.deny === undefined; i++) last = await bash($, 'git status')
    expect(last.deny).toMatch(/Hard stop\. GOAL: BLOCKED/)
    await clock.advance(1)
    expect(w.goalClears).toBe(1)
  })

  test('a new commit on the branch resets the idle count', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await begin($, { max_idle_calls: 3 })
    await bash($, 'ls')
    await bash($, 'ls')
    w.heads[0] = 'bbb'
    await bash($, 'git merge --no-ff lane-1')
    const after = await bash($, 'ls')
    expect(after.context).toBeUndefined()
    await clock.advance(1)
    expect(w.goalClears).toBe(0)
  })

  test('idle calls with no commit trip wrap-up', async ($, on) => {
    mock.clock(on)
    world(on)
    await begin($, { max_idle_calls: 3 })
    await bash($, 'ls')
    await bash($, 'ls')
    expect((await bash($, 'ls')).context?.join(' ')).toMatch(/3 tool calls with no new commit/)
  })

  test('a quiet run is woken, then stopped as BLOCKED', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await begin($)
    for (let i = 0; i < 3; i++) await clock.advance(50 * 60_000)
    expect(w.prompts.length).toBe(2)
    expect(w.prompts[0]).toMatch(/no tool call and no agent report/)
    expect(w.goalClears).toBe(1)
    expect(w.toasts.join(' ')).toMatch(/GOAL: BLOCKED — no activity/)
    expect((await bash($, 'ls')).deny).toMatch(/run is over \(BLOCKED\)/)
  })

  test('a sub-agent at work keeps a long lane from looking quiet', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await begin($)
    for (let i = 0; i < 4; i++) {
      await clock.advance(40 * 60_000)
      await $.tool.call({ tool: 'Bash', command: 'bun test', agentId: 'lane-1' } as never)
    }
    expect(w.prompts.length).toBe(0)
    expect(w.goalClears).toBe(0)
  })

  test("the desktop app's turn tools are never counted or locked", async ($, on) => {
    mock.clock(on)
    world(on)
    await begin($, { max_idle_calls: 2 })
    for (let i = 0; i < 3; i++) {
      const plan = await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
      expect(plan.context).toBeUndefined()
    }
    await $.tool.call({ tool: FINISH, outcome: 'DONE', summary: 'PR #1 merged' } as never)
    expect((await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Shipped.' } as never)).deny).toBeUndefined()
    expect((await bash($, 'ls')).deny).toMatch(/run is over/)
  })

  test('/orchestrator-stop ends the run and clears /goal', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await begin($)
    const stopped = await $.command.run({
      command: 'orchestrator-stop',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(stopped.text).toMatch(/stopped as BLOCKED/)
    expect((await bash($, 'ls')).deny).toMatch(/stopped by the user/)
    await clock.advance(1)
    expect(w.goalClears).toBe(1)
  })
})

describe('goal-orchestrator goal mode', () => {
  test('start_goal queues /goal with the condition once the turn is over', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    const called = await $.tool.call({ tool: START_GOAL, condition: CONDITION, run_file: '/state/RUN.md' } as never)
    expect(called.deny).toBeUndefined()
    expect(String(called.result)).toMatch(/End your turn now/)
    expect(w.goals).toEqual([])
    await clock.advance(1)
    expect(w.goals).toEqual([CONDITION])
  })

  test('the finish line rides the system prompt until /goal is cleared', async ($, on) => {
    const clock = mock.clock(on)
    world(on)
    expect((await $.prompt.compose(COMPOSE as never)).sections).toEqual([])
    await $.tool.call({ tool: START_GOAL, condition: CONDITION, run_file: '/state/RUN.md' } as never)
    await clock.advance(1)
    const [section] = (await $.prompt.compose(COMPOSE as never)).sections
    expect(section?.id).toBe('goal-orchestrator:finish-line')
    expect(section?.text).toContain(CONDITION)
    expect(section?.text).toContain('/state/RUN.md')
    await $.command.run({ command: 'goal', args: 'clear' } as never)
    expect((await $.prompt.compose(COMPOSE as never)).sections).toEqual([])
  })

  test("a compaction keeps the finish line in the main conversation's summary only", async ($, on) => {
    const clock = mock.clock(on)
    world(on)
    const told: (string | undefined)[] = []
    on('session.compact', ($, e) => {
      told.push(e.instructions)
      return { messages: e.messages }
    })
    await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT })
    await $.tool.call({ tool: START_GOAL, condition: CONDITION, run_file: '/state/RUN.md' } as never)
    await clock.advance(1)
    await $.session.compact({ trigger: 'manual', instructions: 'keep the API notes', messages: TRANSCRIPT })
    await $.session.compact({ trigger: 'auto', agentId: 'lane-a', messages: TRANSCRIPT })
    await $.command.run({ command: 'goal', args: 'clear' } as never)
    await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT })
    expect(told[0]).toBeUndefined()
    expect(told[1]).toMatch(/^keep the API notes\n\nKeep this in the summary, word for word:\n/)
    expect(told[1]).toContain(CONDITION)
    expect(told[1]).toContain('/state/RUN.md')
    expect(told[2]).toBeUndefined()
    expect(told[3]).toBeUndefined()
  })

  test('start_goal refuses an empty or oversized condition and queues nothing', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    expect((await $.tool.call({ tool: START_GOAL, condition: '  ' } as never)).deny).toMatch(/needs a condition/)
    expect((await $.tool.call({ tool: START_GOAL, condition: 'x'.repeat(4001) } as never)).deny).toMatch(/at most 4000/)
    await clock.advance(1)
    expect(w.goals).toEqual([])
    expect((await $.prompt.compose(COMPOSE as never)).sections).toEqual([])
  })

  test("the run's end clears the goal and drops the finish line", async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on)
    await $.tool.call({ tool: START_GOAL, condition: CONDITION, run_file: '/state/RUN.md' } as never)
    await clock.advance(1)
    await begin($)
    await $.tool.call({ tool: FINISH, outcome: 'DONE', summary: 'branch pushed' } as never)
    await mainTurnEnds($)
    await clock.advance(1)
    expect(w.goals).toEqual([CONDITION, 'clear'])
    expect((await $.prompt.compose(COMPOSE as never)).sections).toEqual([])
  })

  test('the band is one line: a ring on desktop, ✻ in the terminal, then how the run ended', async ($, on) => {
    const clock = mock.clock(on)
    world(on)
    await begin($)
    await clock.advance(30 * 60_000)

    const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await desktop.find({ type: 'Text', text: /^Shipping$/ }))?.props.color).toBe('claude')
    expect((await desktop.find({ type: 'Text', text: /since a commit/ }))?.text).toBe('Shipping feat/x · 30m of 8h · 0 calls since a commit')
    expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toContain('stroke-dasharray')
    await desktop.unmount()

    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await terminal.find({ type: 'Text', text: /^✻$/ }))?.props.color).toBe('claude')
    await terminal.unmount()

    await $.tool.call({ tool: FINISH, outcome: 'DONE', summary: 'PR #7 merged' } as never)
    const ended = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ended.find({ type: 'Text', text: /^Shipped$/ }))?.props.color).toBe('success')
    expect(String((await ended.find({ type: 'Svg' }))?.props.source)).toContain('M5.5 9.2')
    await ended.unmount()
  })
})
