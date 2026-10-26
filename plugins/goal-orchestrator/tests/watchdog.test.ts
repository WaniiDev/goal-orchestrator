import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = 'mcp__goal-orchestrator__run_start'
const FINISH = 'mcp__goal-orchestrator__run_finish'

type World = { heads: string[]; goalClears: number; prompts: string[]; toasts: string[]; failing: Set<string> }

// The world beneath the plugin: git, the UI, /goal, prompts and the tools themselves.
function world(on: On): World {
  const w: World = { heads: ['aaa'], goalClears: 0, prompts: [], toasts: [], failing: new Set() }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: `${w.heads[0]}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'goal' }, () => {
    w.goalClears += 1
    return { text: 'goal cleared' }
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
