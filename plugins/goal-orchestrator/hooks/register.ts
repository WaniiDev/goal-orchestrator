import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Limits, Outcome, Run } from '../types'

// Exit paths for a goal-orchestrator run, enforced in code instead of prose:
// run_start / run_finish tools, a progress and budget watchdog, a quiet-run
// wake-up, /orchestrator-stop, a /goal clear on every terminal state, and
// command guards while a run is active.

type $ = EngineInterface

const RUN = { plugin: 'goal-orchestrator', key: 'run' } as const
const START = 'mcp__goal-orchestrator__run_start'
const FINISH = 'mcp__goal-orchestrator__run_finish'
// The desktop app's end-of-turn tools (task list, wrap-up box): bookkeeping, not work.
const TURN_TOOLS = 'mcp__ccd_turn__'
const OUTCOMES: readonly Outcome[] = ['DONE', 'PARTIAL', 'BLOCKED']
const CHECK_HEAD_MS = 30_000
const TICK_MS = 5 * 60_000
const MAX_QUIET_WAKES = 2

export const DEFAULTS: Limits = {
  maxHours: 8,
  maxIdleCalls: 60,
  maxSameFailure: 3,
  graceCalls: 15,
  maxQuietMinutes: 45,
}

// Commands no agent may run while a run is active.
export const GUARDS: readonly (readonly [RegExp, string])[] = [
  [/(^|[\s;&|(])(pkill|killall)\s/, 'never kill by pattern; kill only PIDs you started'],
  [/\bkill\b[^;&|]*\$\(\s*pgrep/, 'never kill by pattern; kill only PIDs you started'],
  [/\bgit\s+push\b[^;&|]*\s(--force(?![\w-])|-f\b|\+\S)/, 'no force push (use --force-with-lease on your own lane branch if you must)'],
  [/\bgit\b[^;&|]*\s--no-verify\b/, 'never skip git hooks'],
]

export function guardReason(command: string): string | undefined {
  return GUARDS.find(([pattern]) => pattern.test(command))?.[1]
}

export function failureKey(command: string): string {
  return command.trim().replace(/\s+/g, ' ').slice(0, 200)
}

export function finalLine(outcome: Outcome, summary: string, userAction?: string): string {
  const action = userAction ? `; you must: ${userAction}` : ''
  return `GOAL: ${outcome} — ${summary}${action}`
}

let run: Run | null = null
let ticker: Timer | null = null

async function save($: $): Promise<void> {
  await $.state.set(RUN, run)
}

function status($: $, now: number): void {
  if (run === null) {
    $.ui.status(undefined)
    return
  }
  const minutes = Math.round((now - run.startedAt) / 60_000)
  const elapsed = `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
  const label = run.phase === 'active' ? `idle ${run.idleCalls}/${run.limits.maxIdleCalls}` : run.phase
  $.ui.status(`orchestrator · ${elapsed}/${run.limits.maxHours}h · ${label}`)
}

async function headOf($: $, current: Run): Promise<string> {
  const ran = await $.process.run(['git', '-C', current.repoDir, 'rev-parse', current.branch])
  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

function progress(current: Run, now: number): void {
  current.idleCalls = 0
  current.failures = {}
  current.quietWakes = 0
  current.lastActivityAt = now
}

function wrapUp(current: Run, reason: string): void {
  if (current.phase !== 'active') return
  current.phase = 'wrapup'
  current.reason = reason
  current.graceLeft = current.limits.graceCalls
}

function end($: $, current: Run, phase: 'ended' | 'stopped', outcome: Outcome, summary: string): void {
  current.phase = phase
  current.outcome = outcome
  current.summary = summary
  ticker?.cancel()
  ticker = null
  const line = finalLine(outcome, summary)
  // A session the desktop app hosts has no notification channel for mods: toast there.
  void $.ui
    .notify(line, { title: 'goal-orchestrator' })
    .then(sent => {
      if (!sent.isSent) $.ui.toast(line)
    })
    .catch(() => undefined)
}

// /goal only clears itself on met / impossible / fatal error, so every
// terminal state clears it here, once the session is idle.
function clearGoal($: $): void {
  $.clock.after(0, () => {
    void $.command.run({ command: 'goal', args: 'clear' }).catch(error => {
      $.ui.log(`goal-orchestrator: could not run /goal clear (${String(error)}); run it yourself.`)
    })
  })
}

function wrapUpNotice(current: Run): string {
  return [
    `goal-orchestrator watchdog: ${current.reason}.`,
    'Stop starting new work. Push the branch, save state (RUN.md, DECISIONS.md, draft PR),',
    `remove lane worktrees, then call run_finish with PARTIAL or BLOCKED. ${current.graceLeft} tool calls left before a hard stop.`,
  ].join(' ')
}

function startTicker($: $): void {
  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => {
    void tick($)
  })
}

async function tick($: $): Promise<void> {
  if (run === null || run.phase !== 'active') return
  const now = await $.clock.now()
  if (now - run.startedAt >= run.limits.maxHours * 3_600_000) {
    wrapUp(run, `time budget of ${run.limits.maxHours}h is spent`)
    await save($)
    await $.prompt.submit({ text: wrapUpNotice(run) }).catch(() => undefined)
    return
  }
  if (now - run.lastActivityAt < run.limits.maxQuietMinutes * 60_000) return
  if (run.quietWakes >= MAX_QUIET_WAKES) {
    end($, run, 'stopped', 'BLOCKED', `no activity for ${run.limits.maxQuietMinutes} min after ${MAX_QUIET_WAKES} wake-ups`)
    await save($)
    status($, now)
    clearGoal($)
    return
  }
  run.quietWakes += 1
  run.lastActivityAt = now
  await save($)
  await $.prompt
    .submit({
      text: `goal-orchestrator watchdog: no tool call and no agent report for ${run.limits.maxQuietMinutes} min. Check the running agents (ListAgents); relaunch or drop a hung lane, or call run_finish if the run cannot continue.`,
    })
    .catch(() => undefined)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

const startSpec = {
  name: 'run_start',
  description:
    'Start the goal-orchestrator watchdog for this run (call once after intake, and again on resume). It ends the run as BLOCKED instead of looping when there is no progress, the same command keeps failing, or the time budget is spent.',
  isDeferred: true,
  inputSchema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'The feature branch; a new commit on it counts as progress.' },
      repo_dir: { type: 'string', description: 'Absolute path of the main checkout.' },
      max_hours: { type: 'number', description: `Wall-clock budget (default ${DEFAULTS.maxHours}).` },
      max_idle_calls: { type: 'number', description: `Orchestrator tool calls without progress before wrap-up (default ${DEFAULTS.maxIdleCalls}).` },
      max_same_failure: { type: 'number', description: `Times the same command may fail without progress (default ${DEFAULTS.maxSameFailure}).` },
    },
    required: ['branch', 'repo_dir'],
  },
}

const finishSpec = {
  name: 'run_finish',
  description:
    'End the goal-orchestrator run in exactly one terminal state. Call it last, after pushing the branch, saving state and removing lane worktrees. DONE: everything shipped and verified. PARTIAL: some issues shipped, the rest listed. BLOCKED: only the user can unblock it (auth, secret, permission, approval) or the run cannot make progress.',
  isDeferred: true,
  inputSchema: {
    type: 'object',
    properties: {
      outcome: { type: 'string', enum: OUTCOMES },
      summary: { type: 'string', description: 'One line: PR/branch, what shipped, what did not and why.' },
      user_action: { type: 'string', description: 'For BLOCKED or PARTIAL: what the user must do.' },
    },
    required: ['outcome', 'summary'],
  },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    run = (await $.state.get(RUN)).value ?? null
    await $.tool.register(startSpec)
    await $.tool.register(finishSpec)
    await $.command.register({
      name: 'orchestrator-stop',
      description: 'End the running goal-orchestrator run as BLOCKED and clear /goal',
    })
    if (run !== null && run.phase !== 'ended' && run.phase !== 'stopped') startTicker($)
    return next(e)
  })

  on('command.run', { command: 'orchestrator-stop' }, async $ => {
    if (run === null || run.phase === 'ended' || run.phase === 'stopped') {
      clearGoal($)
      return { text: 'No goal-orchestrator run is active; cleared /goal.' }
    }
    end($, run, 'stopped', 'BLOCKED', 'stopped by the user')
    await save($)
    status($, await $.clock.now())
    clearGoal($)
    return { text: 'Run stopped as BLOCKED. The next tool call is refused and /goal is cleared.' }
  })

  on('tool.call', { tool: START }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const branch = typeof input.branch === 'string' ? input.branch : ''
    const repoDir = typeof input.repo_dir === 'string' ? input.repo_dir : ''
    if (branch === '' || repoDir === '') return { deny: 'run_start needs branch and repo_dir.' }
    const now = await $.clock.now()
    const limits: Limits = {
      ...DEFAULTS,
      maxHours: num(input.max_hours, DEFAULTS.maxHours),
      maxIdleCalls: num(input.max_idle_calls, DEFAULTS.maxIdleCalls),
      maxSameFailure: num(input.max_same_failure, DEFAULTS.maxSameFailure),
    }
    const fresh: Run = {
      branch,
      repoDir,
      startedAt: now,
      lastActivityAt: now,
      checkedAt: now,
      head: '',
      idleCalls: 0,
      failures: {},
      quietWakes: 0,
      graceLeft: limits.graceCalls,
      phase: 'active',
      reason: '',
      outcome: null,
      summary: '',
      limits,
    }
    fresh.head = await headOf($, fresh)
    run = fresh
    await save($)
    startTicker($)
    status($, now)
    return {
      result: `Watchdog on for ${branch}: ${limits.maxHours}h, ${limits.maxIdleCalls} idle calls, ${limits.maxSameFailure} same failures. End the run only through run_finish.`,
    }
  }).catch(() => ({ deny: 'run_start failed inside the goal-orchestrator mod; continue without the watchdog and follow the skill\'s stop rules.' }))

  on('tool.call', { tool: FINISH }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const outcome = OUTCOMES.find(one => one === input.outcome)
    const summary = typeof input.summary === 'string' ? input.summary.trim() : ''
    if (outcome === undefined || summary === '') return { deny: 'run_finish needs outcome (DONE, PARTIAL or BLOCKED) and a summary.' }
    const userAction = typeof input.user_action === 'string' && input.user_action.trim() !== '' ? input.user_action.trim() : undefined
    const line = finalLine(outcome, summary, userAction)
    if (run !== null) {
      end($, run, 'ended', outcome, userAction ? `${summary}; you must: ${userAction}` : summary)
      await save($)
      status($, await $.clock.now())
    }
    return {
      result: `Run recorded as ${outcome}. Make no more tool calls, apart from the app's own end-of-turn wrap-up if it asks for one. End your reply with this exact line:\n${line}`,
    }
  }).catch(() => ({ deny: 'run_finish failed inside the goal-orchestrator mod; end your reply with the GOAL line yourself.' }))

  // Every other tool call: the guards, the terminal lock, and the watchdog.
  on('tool.call', async ($, e, next) => {
    if (e.tool === START || e.tool === FINISH || String(e.tool).startsWith(TURN_TOOLS) || run === null) return next(e)
    const current = run
    const isMain = e.agentId === undefined

    if (current.phase === 'ended' || current.phase === 'stopped') {
      if (e.tool === 'TaskStop') return next(e)
      return {
        deny: `The goal-orchestrator run is over (${current.outcome}). Make no more tool calls; end your reply with: ${finalLine(current.outcome ?? 'BLOCKED', current.summary)}`,
      }
    }

    const command = e.tool === 'Bash' ? e.command : ''
    const guard = command === '' ? undefined : guardReason(command)
    if (guard !== undefined) return { deny: `goal-orchestrator guard: ${guard}.` }

    if (!isMain) {
      // A sub-agent at work is activity, not progress: a long lane is not a quiet run.
      current.lastActivityAt = await $.clock.now()
      return next(e)
    }

    if (current.phase === 'wrapup') {
      if (e.tool === 'Agent') return { deny: `No new agents: ${current.reason}. Wrap up and call run_finish.` }
      current.graceLeft -= 1
      if (current.graceLeft <= 0) {
        end($, current, 'stopped', 'BLOCKED', `watchdog: ${current.reason}, and run_finish was not called`)
        await save($)
        status($, await $.clock.now())
        clearGoal($)
        return { deny: `Hard stop. ${finalLine('BLOCKED', current.summary)} — end your reply with that line.` }
      }
    }

    const ran = await next(e)
    const now = await $.clock.now()
    current.lastActivityAt = now
    current.idleCalls += 1

    if (now - current.checkedAt >= CHECK_HEAD_MS || /\bgit\s+(merge|commit|push)\b/.test(command)) {
      current.checkedAt = now
      const head = await headOf($, current)
      if (head !== '' && head !== current.head) {
        current.head = head
        progress(current, now)
      }
    }

    if (command !== '' && ran.deny === undefined && ran.isError === true) {
      const key = failureKey(command)
      const count = (current.failures[key] ?? 0) + 1
      current.failures[key] = count
      if (count >= current.limits.maxSameFailure) {
        wrapUp(current, `"${key.slice(0, 80)}" failed ${count} times with no new commit`)
      }
    }
    if (current.idleCalls >= current.limits.maxIdleCalls) {
      wrapUp(current, `${current.idleCalls} tool calls with no new commit on ${current.branch}`)
    }

    await save($)
    status($, now)
    if (current.phase !== 'wrapup' || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), wrapUpNotice(current)] }
  }).catch(($, e, next) => {
    // A watchdog failure must not stall the session: keep the guards, let the rest through.
    if (next.called) return next(e)
    const guard = e.tool === 'Bash' ? guardReason(e.command) : undefined
    return guard === undefined ? next(e) : { deny: `goal-orchestrator guard: ${guard}.` }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (run === null) return done
    if (e.agentId !== undefined) {
      // A sub-agent reported back: activity, and progress for the stall count.
      if (run.phase === 'active') {
        progress(run, await $.clock.now())
        await save($)
      }
      return done
    }
    if (run.phase === 'ended' || run.phase === 'stopped') {
      run = null
      await save($)
      status($, 0)
      clearGoal($)
    }
    return done
  })
}
