import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ActiveGoal, ActivePlan, Limits, Outcome, Run } from '../types'

// Goal mode and exit paths for a shipwright run, enforced in code
// instead of prose: start_goal (queues /goal and keeps its finish line in the
// system prompt), run_start / run_finish tools, a progress and budget
// watchdog, a quiet-run wake-up, /shipwright-stop, a /goal clear on every
// terminal state, and command guards while a run is active. Before a run,
// plan_step chains /shipwright:plan's commands: wayfinder, to-spec, to-tickets,
// then a compaction and /shipwright:run.

type $ = EngineInterface

const RUN = { plugin: 'shipwright', key: 'run' } as const
const GOAL = { plugin: 'shipwright', key: 'goal' } as const
const START = 'mcp__shipwright__run_start'
const FINISH = 'mcp__shipwright__run_finish'
const START_GOAL = 'mcp__shipwright__start_goal'
const PLAN = { plugin: 'shipwright', key: 'plan' } as const
const PLAN_STEP = 'mcp__shipwright__plan_step'
// The command each plan stage runs, by its name without a plugin prefix.
const STEPS = { wayfinder: 'wayfinder', spec: 'to-spec', tickets: 'to-tickets' } as const
const NEXT = ['wayfinder', 'spec', 'tickets', 'ship', 'stop'] as const
type Next = (typeof NEXT)[number]
/** `/goal`'s own limit on a condition. */
const MAX_CONDITION = 4000
/** `/goal clear` and its aliases. */
const CLEARS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])
// The desktop app's end-of-turn tools (task list, wrap-up box): bookkeeping, not work.
const TURN_TOOLS = 'mcp__ccd_turn__'
const OUTCOMES: readonly Outcome[] = ['DONE', 'PARTIAL', 'BLOCKED']
const CHECK_HEAD_MS = 30_000
// Each tick also redraws the band, so its clock moves between tool calls.
const TICK_MS = 60_000
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

// The band above the prompt: one quiet line, drawn from the saved run so every save redraws it.
type Tone = 'active' | 'stalling' | 'wrapup' | 'done' | 'partial' | 'blocked'

export type RunView = {
  tone: Tone
  /** What the run is doing, then its branch. */
  label: string
  branch: string
  /** The rest of the line, dim. */
  detail: string
  /** Share of the time budget spent, 0–1. */
  time: number
}

// Claude's own orange while it works; the theme's colors once it needs you or ends.
const TONES: Record<Tone, { theme: string; hex: string }> = {
  active: { theme: 'claude', hex: '#d97757' },
  stalling: { theme: 'warning', hex: '#e0a43a' },
  wrapup: { theme: 'warning', hex: '#e0a43a' },
  done: { theme: 'success', hex: '#5a9e6f' },
  partial: { theme: 'warning', hex: '#e0a43a' },
  blocked: { theme: 'error', hex: '#d0534f' },
}
const STALLING = 2 / 3

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

// Numbers, not sentences: ◷ time used of the budget, ↻ calls since the last commit of the limit. The reasons
// and the summary are in the transcript already.
export function runView(current: Run, now: number): RunView {
  const { limits, branch } = current
  const elapsed = now - current.startedAt
  const budget = limits.maxHours * 3_600_000
  const time = Math.min(1, Math.max(0, elapsed / budget))
  const clock = `◷ ${duration(elapsed)}/${duration(budget)}`
  const calls = `↻ ${current.idleCalls}/${limits.maxIdleCalls}`
  if (current.phase === 'active') {
    const stalling = current.idleCalls / limits.maxIdleCalls >= STALLING
    return { tone: stalling ? 'stalling' : 'active', label: 'Shipping', branch, detail: `${clock}  ${calls}`, time }
  }
  if (current.phase === 'wrapup') {
    return { tone: 'wrapup', label: 'Wrapping up', branch, detail: `${clock}  ${calls}  ${current.graceLeft} left`, time }
  }
  const outcome = current.outcome ?? 'BLOCKED'
  const tone: Tone = outcome === 'DONE' ? 'done' : outcome === 'PARTIAL' ? 'partial' : 'blocked'
  const label = outcome === 'DONE' ? 'Shipped' : outcome === 'PARTIAL' ? 'Partly shipped' : 'Blocked'
  return { tone, label, branch, detail: `◷ ${duration(elapsed)}`, time }
}

// One thin ring, the time budget, that fills clockwise; it ends as a filled dot with a mark.
export function ringSvg(view: RunView): string {
  const { hex } = TONES[view.tone]
  const r = 7
  const length = 2 * Math.PI * r
  const ended = view.tone === 'done' || view.tone === 'partial' || view.tone === 'blocked'
  const body = ended
    ? `<circle cx="9" cy="9" r="8" fill="${hex}"/>` +
      (view.tone === 'done'
        ? '<path d="M5.5 9.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
        : view.tone === 'blocked'
          ? '<path d="M6.5 6.5l5 5m0-5l-5 5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>'
          : '<path d="M5.8 9h6.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>')
    : `<circle cx="9" cy="9" r="${r}" fill="none" stroke="${hex}" stroke-opacity="0.2" stroke-width="2"/>` +
      (view.time > 0
        ? `<circle cx="9" cy="9" r="${r}" fill="none" stroke="${hex}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${Math.max(0.5, length * view.time).toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90 9 9)"/>`
        : '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18">${body}</svg>`
}

// The terminal's mark: Claude's ✻ while it works, then how it ended.
export function terminalGlyph(view: RunView): string {
  return view.tone === 'done' ? '✓' : view.tone === 'blocked' ? '✕' : view.tone === 'partial' ? '◐' : '✻'
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
  // A system notification where the surface has a channel; the band and the GOAL line show the end everywhere else.
  void $.ui.notify(finalLine(outcome, summary), { title: 'shipwright' }).catch(() => undefined)
}

// /goal only clears itself on met / impossible / fatal error, so every
// terminal state clears it here, once the session is idle.
function clearGoal($: $): void {
  void $.state.set(GOAL, null)
  $.clock.after(0, () => {
    void $.command.run({ command: 'goal', args: 'clear' }).catch(error => {
      $.ui.log(`shipwright: could not run /goal clear (${String(error)}); run it yourself.`)
    })
  })
}

function wrapUpNotice(current: Run): string {
  return [
    `shipwright watchdog: ${current.reason}.`,
    'Stop starting new work, and stop a running ship workflow with TaskStop. Push the branch, save state (RUN.md, DECISIONS.md, draft PR),',
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
  if (run === null) return
  $.ui.invalidate('ui.render')
  if (run.phase !== 'active') return
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
    clearGoal($)
    return
  }
  run.quietWakes += 1
  run.lastActivityAt = now
  await save($)
  await $.prompt
    .submit({
      text: `shipwright watchdog: no tool call and no agent report for ${run.limits.maxQuietMinutes} min. Check the ship workflow and any running agents; relaunch or drop what hangs, or call run_finish if the run cannot continue.`,
    })
    .catch(() => undefined)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

const startSpec = {
  name: 'run_start',
  description:
    'Start the shipwright watchdog for this run (call once after intake, and again on resume). It ends the run as BLOCKED instead of looping when there is no progress, the same command keeps failing, or the time budget is spent.',
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
    'End the shipwright run in exactly one terminal state. Call it last, after pushing the branch, saving state and removing lane worktrees. DONE: everything shipped and verified. PARTIAL: some issues shipped, the rest listed. BLOCKED: only the user can unblock it (auth, secret, permission, approval) or the run cannot make progress.',
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

const startGoalSpec = {
  name: 'start_goal',
  description:
    "Turn on Claude Code goal mode for a shipwright run: queues `/goal <condition>` exactly as if the user typed it. Call it once, right after the run skill's intake. The goal starts when this turn ends: say in one line that goal mode is armed, then end your turn.",
  isDeferred: true,
  inputSchema: {
    type: 'object',
    properties: {
      condition: { type: 'string', description: `The /goal completion condition, at most ${MAX_CONDITION} characters.` },
      run_file: { type: 'string', description: "Absolute path of the run's RUN.md." },
    },
    required: ['condition'],
  },
}

const planStepSpec = {
  name: 'plan_step',
  description:
    "Move a /shipwright:plan to its next stage: queues that stage's command exactly as if the user typed it, once this turn ends. wayfinder: `/wayfinder <goal>`. spec: `/to-spec`. tickets: `/to-tickets <spec issue>`. ship: `/compact`, then `/shipwright:run Implement <issue> and its sub-issues` (or `Implement the tickets in <folder>` for a local-markdown tracker). stop: ends the plan. Say in one line what comes next, then end your turn.",
  isDeferred: true,
  inputSchema: {
    type: 'object',
    properties: {
      next: { type: 'string', enum: NEXT },
      goal: { type: 'string', description: "wayfinder: the idea in the user's words." },
      issue: { type: 'string', description: 'tickets: the spec issue. ship: the parent issue whose sub-issues are the tickets, or the folder that holds them for a local-markdown tracker.' },
      run_args: { type: 'string', description: 'The first plan_step of a plan: extra arguments for /shipwright:run at the end, such as --auto.' },
    },
    required: ['next'],
  },
}

function planLine(plan: ActivePlan): string {
  return [
    'A /shipwright:plan is active in this session: it takes an idea to tickets, then ships them with /shipwright:run.',
    `The idea: ${plan.goal}`,
    `Stage: ${plan.stage}${plan.issue ? ` (${plan.issue})` : ''}. When the stage is done, call plan_step (load ${PLAN_STEP} with ToolSearch) with the next stage and end your turn; the plugin runs the next command.`,
    "- wayfinder, then spec: once the way is clear. Wayfinder making no map is normal: when nothing needs research, a prototype or more decisions, go straight to spec with no map. With a map, once every map ticket is closed. That is how to proceed; don't ask. If the map still has open tickets, tell the user to work them with /wayfinder <map> and to run /shipwright:plan <map> once the way is clear, then call plan_step with stop.",
    '- spec, then tickets: once the spec is published, with its issue.',
    '- tickets, then ship: once the user approved the tickets and they are published as sub-issues of the spec, with the spec issue (or, for a local-markdown tracker, the folder the ticket files are in).',
    'If a stage cannot go on (no issue tracker set up: /setup-matt-pocock-skills), tell the user and call plan_step with stop.',
  ].join('\n')
}

// A plugin's command is listed as `<plugin>:<name>`; take whichever spelling this session has.
async function commandNamed($: $, name: string): Promise<string | undefined> {
  const names = (await $.command.list()).map(command => command.name)
  return names.find(one => one === name) ?? names.find(one => one.endsWith(`:${name}`))
}

function finishLine(goal: ActiveGoal): string {
  return [
    'A shipwright run is active in this session, in goal mode.',
    `Its finish line (the /goal condition): ${goal.condition}`,
    `Its state is in ${goal.runFile || 'RUN.md in the scratchpad'}: re-read it before acting after a compaction or a resume, then continue the shipwright:run skill from the step it records.`,
    'If `/goal` reports the goal achieved or cleared, this no longer applies.',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    run = (await $.state.get(RUN)).value ?? null
    await $.tool.register(startGoalSpec)
    await $.tool.register(startSpec)
    await $.tool.register(finishSpec)
    await $.tool.register(planStepSpec)
    await $.command.register({
      name: 'shipwright-stop',
      description: 'End the running shipwright run as BLOCKED and clear /goal, or end a /shipwright:plan',
    })
    if (run !== null && run.phase !== 'ended' && run.phase !== 'stopped') startTicker($)
    return next(e)
  })

  on('command.run', { command: 'shipwright-stop' }, async $ => {
    if ((await $.state.get(PLAN)).value) {
      await $.state.set(PLAN, null)
      if (run === null) return { text: 'Plan ended; nothing more runs.' }
    }
    if (run === null || run.phase === 'ended' || run.phase === 'stopped') {
      clearGoal($)
      return { text: 'No shipwright run is active; cleared /goal.' }
    }
    end($, run, 'stopped', 'BLOCKED', 'stopped by the user')
    await save($)
    clearGoal($)
    return { text: 'Run stopped as BLOCKED. The next tool call is refused and /goal is cleared.' }
  })

  on('tool.call', { tool: START_GOAL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const condition = typeof input.condition === 'string' ? input.condition.trim() : ''
    if (condition === '') return { deny: 'start_goal needs a condition.' }
    if (condition.length > MAX_CONDITION) {
      return { deny: `The condition is ${condition.length} characters; /goal takes at most ${MAX_CONDITION}.` }
    }
    const runFile = typeof input.run_file === 'string' ? input.run_file.trim() : ''
    const goal: ActiveGoal = { condition, runFile, setAt: await $.clock.now() }
    await $.state.set(GOAL, goal)
    // A slash command can't run inside the hook the turn is waiting on: queue it for when the session is idle.
    $.clock.after(0, () => {
      void $.command.run({ command: 'goal', args: condition }).catch(() => {
        $.ui.toast('shipwright: /goal could not start. Type /goal and paste the condition from RUN.md.')
      })
    })
    return {
      result: `Goal mode is queued: /goal starts when this turn ends and keeps the run going until this condition is met:\n${condition}\nEnd your turn now.`,
    }
  }).catch(() => ({ deny: 'start_goal failed inside the shipwright mod; give the user the /goal line from RUN.md to paste.' }))

  on('tool.call', { tool: PLAN_STEP }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '')
    const next = NEXT.find(one => one === input.next) as Next | undefined
    if (next === undefined) return { deny: `plan_step needs next: one of ${NEXT.join(', ')}.` }
    const plan = (await $.state.get(PLAN)).value ?? null
    if (next === 'stop') {
      await $.state.set(PLAN, null)
      return { result: 'Plan ended. Tell the user where it stopped and what to run next.' }
    }
    if (next === 'wayfinder' && text('goal') === '') return { deny: "plan_step wayfinder needs goal: the idea in the user's words." }
    const issue = text('issue') || (plan?.issue ?? '')
    if ((next === 'tickets' || next === 'ship') && issue === '') return { deny: `plan_step ${next} needs issue.` }
    // A plan can start at any stage: from an idea, a cleared map, a spec or published tickets.
    const extra = text('run_args') || (plan?.runArgs ?? '')

    if (next === 'ship') {
      const ship = await commandNamed($, 'shipwright:run')
      if (ship === undefined) return { deny: '/shipwright:run is not in this session; reload the plugin.' }
      const runArgs = extra ? ` ${extra}` : ''
      // A local-markdown tracker's tickets are files in a folder, not sub-issues.
      // The spec named at the tickets stage, when the tickets live elsewhere (a local folder): the run reads it too.
      const spec = plan?.issue && plan.issue !== issue ? ` (spec: ${plan.issue})` : ''
      const work = /[\\/]|\.md$/.test(issue) ? `the tickets in ${issue}${spec}` : `${issue} and its sub-issues${spec}`
      await $.state.set(PLAN, null)
      // Queued in order for when the session is idle: the run starts from the tickets, not the planning talk.
      $.clock.after(0, () => {
        void (async () => {
          await $.command
            .run({ command: 'compact', args: `Planning is done; ${work} hold the plan. Keep only the idea, where the tickets are, and any decision not written in them.` })
            .catch(() => undefined)
          await $.command.run({ command: ship, args: `Implement ${work}${runArgs}` })
        })().catch(() => {
          $.ui.toast(`shipwright: /shipwright:run could not start. Type /shipwright:run Implement ${work}.`)
        })
      })
      return { result: `Queued /compact, then /shipwright:run Implement ${work}${runArgs}. They start when this turn ends. End your turn now.` }
    }

    const command = await commandNamed($, STEPS[next])
    if (command === undefined) {
      return { deny: `/${STEPS[next]} is not in this session: install the mattpocock-skills plugin, run /setup-matt-pocock-skills once in this repo, then try again.` }
    }
    const fresh: ActivePlan =
      next === 'wayfinder' || plan === null
        ? { stage: next, goal: text('goal') || issue, issue: next === 'wayfinder' ? '' : issue, runArgs: extra }
        : { ...plan, stage: next, issue, runArgs: extra }
    await $.state.set(PLAN, fresh)
    const args = next === 'wayfinder' ? fresh.goal : next === 'tickets' ? issue : ''
    $.clock.after(0, () => {
      void $.command.run({ command, args }).catch(() => {
        $.ui.toast(`shipwright: /${command} could not start. Type it yourself.`)
      })
    })
    return { result: `Queued /${command}${args ? ` ${args}` : ''}: it starts when this turn ends. End your turn now.` }
  }).catch(() => ({ deny: 'plan_step failed inside the shipwright mod; tell the user which command to run next.' }))

  // `/goal clear`, or a /goal for something else, ends this run's hold on the finish line.
  on('command.run', { command: 'goal' }, async ($, e, next) => {
    const args = e.args.trim()
    const goal = (await $.state.get(GOAL)).value ?? null
    if (goal !== null && args !== '' && (CLEARS.has(args.toLowerCase()) || args !== goal.condition)) {
      await $.state.set(GOAL, null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Keeps the finish line in the system prompt, so it survives a compaction even if the conversation does not.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const goal = (await $.state.get(GOAL)).value ?? null
    const plan = (await $.state.get(PLAN)).value ?? null
    if (goal === null && plan === null) return composed
    const sections = [...composed.sections]
    if (goal !== null) sections.push({ id: 'shipwright:finish-line', text: finishLine(goal), scope: 'session' })
    if (plan !== null) sections.push({ id: 'shipwright:plan', text: planLine(plan), scope: 'session' })
    return { ...composed, sections }
  })

  // Some surfaces put session sections in the first message, which a compaction summarizes away: the summary
  // keeps the finish line too. A subagent's compaction is its own.
  on('session.compact', async ($, e, next) => {
    const goal = e.agentId === undefined ? ((await $.state.get(GOAL)).value ?? null) : null
    const plan = e.agentId === undefined ? ((await $.state.get(PLAN)).value ?? null) : null
    if (goal === null && plan === null) return next(e)
    const lines = [goal && finishLine(goal), plan && planLine(plan)].filter(Boolean).join('\n\n')
    const keep = `Keep this in the summary, word for word:\n${lines}`
    return next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${keep}` : keep })
  }).catch(($, e, next) => next(e))

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
    return {
      result: `Watchdog on for ${branch}: ${limits.maxHours}h, ${limits.maxIdleCalls} idle calls, ${limits.maxSameFailure} same failures. End the run only through run_finish.`,
    }
  }).catch(() => ({ deny: 'run_start failed inside the shipwright mod; continue without the watchdog and follow the skill\'s stop rules.' }))

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
    }
    return {
      result: `Run recorded as ${outcome}. Make no more tool calls, apart from the app's own end-of-turn wrap-up if it asks for one. End your reply with this exact line:\n${line}`,
    }
  }).catch(() => ({ deny: 'run_finish failed inside the shipwright mod; end your reply with the GOAL line yourself.' }))

  // Every other tool call: the guards, the terminal lock, and the watchdog.
  on('tool.call', async ($, e, next) => {
    if (e.tool === START || e.tool === FINISH || e.tool === START_GOAL || e.tool === PLAN_STEP || String(e.tool).startsWith(TURN_TOOLS) || run === null) {
      return next(e)
    }
    const current = run
    const isMain = e.agentId === undefined

    if (current.phase === 'ended' || current.phase === 'stopped') {
      if (e.tool === 'TaskStop') return next(e)
      return {
        deny: `The shipwright run is over (${current.outcome}). Make no more tool calls; end your reply with: ${finalLine(current.outcome ?? 'BLOCKED', current.summary)}`,
      }
    }

    const command = e.tool === 'Bash' ? e.command : ''
    const guard = command === '' ? undefined : guardReason(command)
    if (guard !== undefined) return { deny: `shipwright guard: ${guard}.` }

    if (!isMain) {
      // A sub-agent at work is activity, not progress: a long lane is not a quiet run.
      current.lastActivityAt = await $.clock.now()
      return next(e)
    }

    if (current.phase === 'wrapup') {
      if (e.tool === 'Agent' || e.tool === 'Workflow') return { deny: `No new agents or workflows: ${current.reason}. Wrap up and call run_finish.` }
      current.graceLeft -= 1
      if (current.graceLeft <= 0) {
        end($, current, 'stopped', 'BLOCKED', `watchdog: ${current.reason}, and run_finish was not called`)
        await save($)
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
    if (current.phase !== 'wrapup' || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), wrapUpNotice(current)] }
  }).catch(($, e, next) => {
    // A watchdog failure must not stall the session: keep the guards, let the rest through.
    if (next.called) return next(e)
    const guard = e.tool === 'Bash' ? guardReason(e.command) : undefined
    return guard === undefined ? next(e) : { deny: `shipwright guard: ${guard}.` }
  })

  // The band: a ring on desktop, Claude's ✻ in the terminal, one line each. It yields to a survey and leaves with the run.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = (await $.state.get(RUN)).value ?? null
    if (current === null || e.props.hasSurvey) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const view = runView(current, await $.clock.now())
    const color = TONES[view.tone].theme
    const { Box, Text } = $.ui.resolve(e)
    const line = (
      <Text wrap="truncate-end">
        <Text color={color} weight="medium">{view.label}</Text> <Text mono>{view.branch}</Text>
        <Text dimColor tabular>{'   '}{view.detail}</Text>
      </Text>
    )
    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="row" gap="sm">
          <Text color={color}>{terminalGlyph(view)}</Text>
          {line}
        </Box>
      )
    }
    const { Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Svg source={ringSvg(view)} alt={`${view.label} ${view.branch}, ${Math.round(view.time * 100)}% of the time budget used`} width={18} height={18} />
        {line}
      </Box>
    )
  }).catch(($, e, next) => next(e))

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
      // The reply's GOAL line meets the /goal condition, which clears itself, and a stop already cleared it:
      // another /goal clear would only print "No goal set" as the session's last word.
      await $.state.set(GOAL, null)
    }
    return done
  })
}
