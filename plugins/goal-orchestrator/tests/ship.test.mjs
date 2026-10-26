// The ship workflow's control flow, with every agent faked.
// Run: node --test plugins/goal-orchestrator/tests/ship.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The workflow runtime runs the script body as an async function with these globals.
const source = readFileSync(new URL('../workflows/ship.js', import.meta.url), 'utf8')
const AsyncFunction = (async () => {}).constructor
const script = new AsyncFunction(
  'agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow',
  source.replace('export const meta =', 'const meta ='),
)

const OK = { cmd: 'npm test', pass: true, counts: '12 passed' }
const NO_BUDGET = { total: null, spent: () => 0, remaining: () => Infinity }

const PLAN = {
  repo: '/repo',
  branch: 'feat/game',
  base: 'base-sha',
  brief: '/state/BRIEF.md',
  mode: 'away',
  models: { implementer: { model: 'sonnet', effort: 'medium' }, reviewer: { model: 'opus', effort: 'xhigh' } },
  checks: { fast: ['npm run typecheck', 'npm test'], full: ['npm run typecheck', 'npm test', 'npx playwright test'] },
  waves: [
    {
      lanes: [
        { id: 'board', issues: ['GAME-1'], doneWhen: ['the board is 10x20', 'a piece falls a row per tick'], owns: ['src/board.ts'] },
        { id: 'input', issues: ['GAME-2'], doneWhen: ['arrow keys move the piece'], owns: ['src/input.ts'] },
      ],
    },
  ],
}

const plan = changes => ({ ...structuredClone(PLAN), ...changes })
const matches = (prompt, pattern) => [...prompt.matchAll(pattern)].map(m => m[1])

function doneWhenIn(prompt) {
  const lines = prompt.split('\n')
  const start = lines.indexOf('Done when:')
  const items = []
  for (let i = start + 1; i < lines.length && lines[i].startsWith('- '); i++) items.push(lines[i].slice(2))
  return items
}

// What a well-behaved agent returns, by the label the workflow gives it.
function standard(label, prompt) {
  if (label.endsWith(' contract')) {
    return { sha: 'contract-sha', lanes: matches(prompt, /^Lane (\S+) \(/gm).map(id => ({ id, files: [`tests/${id}.test.ts`], untestable: [] })) }
  }
  if (/ (build|fix \d+)$/.test(label)) {
    const items = doneWhenIn(prompt)
    return {
      status: 'done',
      sha: 'lane-sha',
      files: ['src/x.ts'],
      doneWhen: items.map(item => ({ item, met: true, proof: 'a test' })),
      checks: [OK],
      decisions: [],
      open: [],
    }
  }
  if (label.endsWith(' check')) return { checks: [{ ...OK, matchesReport: true }], contractUntouched: true, clean: true, outsideFiles: [] }
  // Real merge agents name lanes by branch (lane-<id>), as the cloud stress run showed.
  if (label.endsWith(' merge')) return { head: `head after ${label}`, merged: matches(prompt, /^- [^:\s]+: branch (lane-[^,\s]+),/gm), failed: [], checks: [OK] }
  if (label.startsWith('gate')) return { head: 'gate-head', checks: [OK], failures: [] }
  return { findings: [] }
}

// Runs the script. An override answers for one label: a value, or (prompt, nth call) => value.
async function ship(args, overrides = {}, budget = NO_BUDGET) {
  const calls = []
  const logs = []
  const count = {}
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, ...opts })
    const { label } = opts
    count[label] = (count[label] || 0) + 1
    const override = overrides[label]
    if (override === undefined) return standard(label, prompt)
    return typeof override === 'function' ? override(prompt, count[label]) : override
  }
  const parallel = thunks => Promise.all(thunks.map(thunk => Promise.resolve().then(thunk).catch(() => null)))
  const unused = name => () => {
    throw new Error(`${name} is not used by ship.js`)
  }
  const result = await script(agent, parallel, unused('pipeline'), () => undefined, m => logs.push(m), args, budget, unused('workflow'))
  const labels = calls.map(call => call.label)
  const prompt = label => calls.find(call => call.label === label)?.prompt ?? ''
  return { result, calls, labels, logs, prompt }
}

const red = (problem, files) => ({ head: 'gate-head', checks: [{ ...OK, pass: false, counts: '1 failed' }], failures: [{ problem, files }] })

test('refuses to run without a plan', async () => {
  const { result, calls } = await ship(undefined)
  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(calls.length, 0)
})

test('a clean run writes the contract first, ships every lane and ends DONE', async () => {
  const { result, labels, prompt } = await ship(plan())
  assert.equal(result.outcome, 'DONE')
  assert.deepEqual(result.shipped.map(lane => lane.id), ['board', 'input'])
  assert.equal(labels[0], 'wave 1 contract')
  for (const label of ['board build', 'board check', 'input build', 'input check', 'wave 1 merge', 'wave 1 review', 'gate 1', 'the whole diff review']) {
    assert.ok(labels.includes(label), label)
  }
  assert.ok(!labels.some(label => /fix/.test(label)))
  assert.match(prompt('board build'), /git checkout contract-sha -- tests\/board\.test\.ts and commit them/)
  assert.doesNotMatch(prompt('board build'), /input\.test/)
  assert.match(prompt('wave 1 contract'), /worktree add -b contract-wave-1/)
  assert.match(prompt('wave 1 contract'), /typecheck and lint under its config as it is\. Write no feature code and change no config/)
  assert.match(prompt('wave 1 review'), /git diff base-sha\.\.head after wave 1 merge/)
  assert.equal(result.head, 'gate-head')
  assert.equal(result.gate.green, true)
})

test('merges, gates and reviews run in clean worktrees, away from the lane worktrees in the main checkout', async () => {
  const { prompt } = await ship(plan())
  assert.match(prompt('wave 1 merge'), /worktree add --detach \/repo\/\.claude\/worktrees\/check-wave-1 HEAD/)
  assert.match(prompt('gate 1'), /worktree add --detach \/repo\/\.claude\/worktrees\/check-gate-1 feat\/game/)
  assert.match(prompt('wave 1 review'), /worktree add --detach \/repo\/\.claude\/worktrees\/review-wave-1 feat\/game/)
  assert.match(prompt('the whole diff review'), /worktrees\/review-the-whole-diff /)
})

test('each role keeps its own model and effort', async () => {
  const { calls } = await ship(plan({ ui: { reference: 'docs/design.png', standard: 'house', areas: [{ name: 'board' }] } }), {})
  const byType = type => calls.filter(call => call.agentType === `goal-orchestrator:${type}`)
  for (const call of byType('implementer')) assert.deepEqual([call.model, call.effort], ['sonnet', 'medium'])
  for (const call of byType('reviewer')) assert.deepEqual([call.model, call.effort], ['opus', 'xhigh'])
  for (const call of byType('integrator')) assert.deepEqual([call.model, call.effort], [undefined, undefined])
  assert.ok(byType('implementer').length > 0 && byType('reviewer').length > 0 && byType('integrator').length > 0)

  const defaults = await ship(plan({ models: undefined }))
  for (const call of defaults.calls) assert.ok(!('model' in call) && !('effort' in call), call.label)
})

test('UI lanes get one audit per area, on the reviewer model unless the auditor has its own', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].ui = true
  const ui = { reference: 'docs/design.png', standard: 'house', areas: [{ name: 'board' }, { name: 'menus' }] }
  const { calls, labels } = await ship(plan({ waves, ui }))
  const audits = calls.filter(call => call.agentType === 'goal-orchestrator:ui-auditor')
  assert.deepEqual(audits.map(call => call.label), ['wave 1 audit board', 'wave 1 audit menus', 'the whole diff audit board', 'the whole diff audit menus'])
  for (const call of audits) assert.deepEqual([call.model, call.effort], ['opus', 'xhigh'])
  assert.ok(labels.includes('wave 1 review'))
})

test('UI audits without a design reference check the Done-when items at desktop and phone sizes', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].ui = true
  const { prompt } = await ship(plan({ waves, ui: { areas: [{ name: 'board' }] } }))
  const audit = prompt('wave 1 audit board')
  assert.match(audit, /No design reference: the Done-when items about the screen are the reference/)
  assert.match(audit, /desktop \(1280×720\) and phone \(390×844\)/)
  assert.match(audit, /Issues and Done-when:\n- GAME-1: the board is 10x20/)
  assert.doesNotMatch(audit, /undefined/)
})

test('untested Done-when items, lane notes and outside edits reach the reviewers and the result', async () => {
  const { result, prompt } = await ship(plan(), {
    'wave 1 contract': {
      sha: 'contract-sha',
      lanes: [
        { id: 'board', files: ['tests/board.test.ts'], untestable: ['the board fits a 1280x720 window: needs a real browser'] },
        { id: 'input', files: ['tests/input.test.ts'], untestable: [] },
      ],
    },
    'board build': prompt => ({ ...standard('board build', prompt), open: ['the HUD layout needs the renderer'] }),
    'board check': { checks: [{ ...OK, matchesReport: true }], contractUntouched: true, clean: true, outsideFiles: ['tsconfig.json'] },
  })
  const review = prompt('wave 1 review')
  assert.match(review, /GAME-1: no automated test proves this, so check it by hand: the board fits a 1280x720 window/)
  assert.match(review, /GAME-1: the lane left a note: the HUD layout needs the renderer/)
  assert.match(review, /GAME-1: changed files outside its own: tsconfig\.json/)
  assert.match(prompt('the whole diff review'), /check each by hand:\n- GAME-1: the board fits a 1280x720 window/)
  assert.deepEqual(result.untestable, ['GAME-1: the board fits a 1280x720 window: needs a real browser'])
  const board = result.lanes.find(lane => lane.id === 'board')
  assert.deepEqual([board.notes, board.outside], [['the HUD layout needs the renderer'], ['tsconfig.json']])
  assert.equal(result.outcome, 'DONE')
})

test('fix lanes show under the round that made them, and a lane report must cover every item and name a commit', async () => {
  const finding = { severity: 'should', file: 'src/board.ts', problem: 'step() is not pure', fix: 'copy the queue' }
  const { calls } = await ship(plan(), {
    'wave 1 review': { findings: [finding] },
    'gate 1': red('line clear is off by one', ['src/board.ts']),
  })
  const phaseOf = label => calls.find(call => call.label === label)?.phase
  assert.deepEqual(
    ['board build', 'board check', 'wave-1-review-fix1 build', 'wave-1-review-fix1 check', 'gate-1-fix1 build'].map(phaseOf),
    ['Build', 'Build', 'Review', 'Review', 'Final gate'],
  )
  const { schema } = calls.find(call => call.label === 'board build')
  assert.equal(schema.properties.doneWhen.minItems, 2)
  const sha = new RegExp(schema.properties.sha.pattern)
  assert.ok(sha.test('411d9b3') && sha.test('') && !sha.test('see-below'))
})

test('a claim that does not re-run gets a fix attempt with the exact gap', async () => {
  const { result, prompt } = await ship(plan(), {
    'board check': (_, nth) =>
      nth === 1
        ? { checks: [{ ...OK, counts: '9 passed', matchesReport: false }], contractUntouched: true, clean: true, outsideFiles: [] }
        : standard('board check'),
  })
  assert.match(prompt('board fix 1'), /re-run counts differ from the report: npm test \(9 passed\)/)
  assert.equal(result.lanes.find(lane => lane.id === 'board').attempts, 2)
  assert.equal(result.outcome, 'DONE')
})

test('edited contract tests and edits to another lane\'s files block the merge', async () => {
  const { prompt } = await ship(plan(), {
    'board check': (_, nth) =>
      nth === 1
        ? { checks: [{ ...OK, matchesReport: true }], contractUntouched: false, clean: true, outsideFiles: ['src/input.ts', 'README.md'] }
        : standard('board check'),
  })
  assert.match(prompt('board fix 1'), /contract tests were edited/)
  assert.match(prompt('board fix 1'), /edited src\/input\.ts, which lane input owns/)
  assert.doesNotMatch(prompt('board fix 1'), /README/)
})

test('a lane that keeps failing is dropped after its retries and the run is PARTIAL', async () => {
  const failing = { checks: [{ ...OK, pass: false, counts: '2 failed', matchesReport: true }], contractUntouched: true, clean: true, outsideFiles: [] }
  const { result, labels, prompt } = await ship(plan(), { 'input check': failing })
  assert.deepEqual(labels.filter(label => label.startsWith('input ') && label !== 'input check'), ['input build', 'input fix 1', 'input fix 2'])
  assert.doesNotMatch(prompt('wave 1 merge'), /lane-input/)
  assert.equal(result.outcome, 'PARTIAL')
  assert.equal(result.notShipped.length, 1)
  assert.equal(result.notShipped[0].id, 'input')
  assert.match(result.notShipped[0].why, /re-run failed: npm test \(2 failed\)/)
  assert.deepEqual(result.leftover, ['/repo/.claude/worktrees/lane-input'])
})

test('a re-check that skips reported checks is a gap', async () => {
  const { prompt } = await ship(plan(), {
    'board check': (_, nth) => (nth === 1 ? { checks: [], contractUntouched: true, clean: true, outsideFiles: [] } : standard('board check')),
  })
  assert.match(prompt('board fix 1'), /only 0 of the 1 reported checks could be re-run/)
})

test('an agent that throws (a spent budget) stops the run but still returns the result', async () => {
  const { result, labels } = await ship(plan(), {
    'gate 1': () => {
      throw new Error('token budget spent')
    },
  })
  assert.equal(result.outcome, 'PARTIAL')
  assert.match(result.stopped, /gate 1 failed: token budget spent/)
  assert.deepEqual(result.shipped.map(lane => lane.id), ['board', 'input'])
  assert.ok(!labels.includes('the whole diff review'))
})

test('a blocked lane is dropped at once, with no retries', async () => {
  const { result, labels } = await ship(plan(), {
    'input build': { status: 'blocked', sha: '', files: [], doneWhen: [], checks: [], open: ['needs the LEADERBOARD_TOKEN secret'] },
  })
  assert.ok(!labels.includes('input check') && !labels.includes('input fix 1'))
  assert.equal(result.outcome, 'PARTIAL')
  assert.equal(result.notShipped[0].why, 'needs the LEADERBOARD_TOKEN secret')
})

test('lanes merged under their branch names or bare ids both count as merged', async () => {
  const { result, labels, prompt } = await ship(plan(), {
    'wave 1 merge': { head: 'h1', merged: ['lane-board', 'input'], failed: [], checks: [OK] },
  })
  assert.equal(result.outcome, 'DONE')
  assert.deepEqual(result.notShipped, [])
  assert.deepEqual(result.leftover, [])
  assert.ok(labels.includes('wave 1 review'))
  assert.match(prompt('the whole diff review'), /GAME-1: .*\n- GAME-2: /)
})

test('a failed merge keeps the lane out of the shipped list', async () => {
  const { result } = await ship(plan(), {
    'wave 1 merge': { head: 'h1', merged: ['board'], failed: [{ id: 'input', why: 'conflict in package.json' }], checks: [OK] },
  })
  assert.equal(result.outcome, 'PARTIAL')
  assert.deepEqual(result.notShipped, [{ id: 'input', issues: ['GAME-2'], why: 'the merge failed' }])
})

test('a high-risk lane is reviewed before it merges, and a must-fix goes back to it', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].risk = 'high'
  const must = { severity: 'must', file: 'src/board.ts', line: 40, problem: 'a full row at the top is never cleared', fix: 'scan row 0 too' }
  const { result, labels, prompt } = await ship(plan({ waves }), {
    'board review': (_, nth) => ({ findings: nth === 1 ? [must, { ...must, severity: 'nit', problem: 'naming' }] : [] }),
  })
  assert.match(prompt('board fix 1'), /must src\/board\.ts:40 — a full row at the top is never cleared/)
  assert.doesNotMatch(prompt('board fix 1'), /naming/)
  assert.ok(!labels.includes('input review'))
  assert.equal(result.outcome, 'DONE')
})

test('review findings become at most four fix lanes grouped by file; nits are skipped unless security', async () => {
  const finding = (file, severity = 'should', security = false) => ({ severity, file, problem: `bug in ${file}`, fix: 'fix it', security })
  const findings = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map(file => finding(file))
  findings.push(finding('f.ts', 'nit'), finding('g.ts', 'nit', true), finding('a.ts', 'must'))
  const { result, labels, logs, calls } = await ship(plan(), { 'wave 1 review': { findings } })
  const builds = labels.filter(label => /^wave-1-review-fix\d build$/.test(label))
  assert.equal(builds.length, 4)
  assert.ok(logs.some(line => /findings in 6 files grouped into 4 fix lanes/.test(line)))
  const fixPrompts = calls.filter(call => /^wave-1-review-fix\d build$/.test(call.label)).map(call => call.prompt).join('\n')
  assert.doesNotMatch(fixPrompts, /bug in f\.ts/)
  assert.match(fixPrompts, /should \(security\) g\.ts|nit \(security\) g\.ts/)
  assert.match(fixPrompts, /must a\.ts — bug in a\.ts/)
  assert.deepEqual(result.reviews[0], { round: 'wave 1', findings: 8, actionable: 7, open: 0 })
  assert.equal(result.outcome, 'DONE')
})

test('a red gate gets a fix lane, then passes', async () => {
  const { result, labels } = await ship(plan(), {
    'gate 1': red('line clear is off by one', ['src/board.ts']),
  })
  assert.ok(labels.includes('gate-1-fix1 build'))
  assert.ok(labels.includes('gate 1 fixes merge'))
  assert.ok(labels.includes('gate 2'))
  assert.equal(result.outcome, 'DONE')
})

test('a gate that stays red stops after its rounds, with no final review, and the run is PARTIAL', async () => {
  const { result, labels } = await ship(plan(), {
    'gate 1': red('flaky e2e', ['e2e/play.spec.ts']),
    'gate 2': red('flaky e2e', ['e2e/play.spec.ts']),
    'gate 3': red('flaky e2e', ['e2e/play.spec.ts']),
  })
  assert.deepEqual(labels.filter(label => /^gate \d$/.test(label)), ['gate 1', 'gate 2', 'gate 3'])
  assert.ok(!labels.includes('the whole diff review'))
  assert.equal(result.gate.green, false)
  assert.equal(result.outcome, 'PARTIAL')
})

test('a gate fix that does not merge ends the gate and leaves the failure open', async () => {
  const failing = { checks: [{ ...OK, pass: false, counts: '1 failed', matchesReport: true }], contractUntouched: true, clean: true, outsideFiles: [] }
  const { result, labels } = await ship(plan(), {
    'gate 1': red('score overflows at 1e6', ['src/score.ts']),
    'gate-1-fix1 check': failing,
  })
  assert.deepEqual(labels.filter(label => /^gate \d$/.test(label)), ['gate 1'])
  assert.ok(result.open.some(line => /score overflows at 1e6/.test(line)))
  assert.equal(result.outcome, 'PARTIAL')
})

test('around mode returns questions instead of guessing', async () => {
  const { result, labels } = await ship(plan({ mode: 'around' }), {
    'input build': { status: 'partial', sha: 'x', files: [], doneWhen: [], checks: [], questions: ['Wrap at the walls or stop?'] },
  })
  assert.deepEqual(result.questions, ['input: Wrap at the walls or stop?'])
  assert.ok(!labels.includes('input check'))
  assert.equal(result.notShipped[0].why, 'waiting on the user')
  assert.equal(result.outcome, 'PARTIAL')
})

test('docs-only lanes skip the contract and the review', async () => {
  const waves = [{ lanes: [{ id: 'docs', kind: 'docs', issues: ['GAME-9'], doneWhen: ['README explains the controls'], owns: ['README.md'] }] }]
  const { result, labels } = await ship(plan({ waves }))
  assert.ok(!labels.includes('wave 1 contract'))
  assert.ok(!labels.includes('wave 1 review'))
  assert.ok(labels.includes('wave 1 merge'))
  assert.equal(result.outcome, 'DONE')
})

test('a nearly spent token budget stops before the next wave', async () => {
  const waves = [...structuredClone(PLAN.waves), { lanes: [{ id: 'score', issues: ['GAME-3'], doneWhen: ['a line scores 100'], owns: ['src/score.ts'] }] }]
  let merged = false
  const budget = { total: 1_000_000, spent: () => 0, remaining: () => (merged ? 10_000 : 900_000) }
  const { result, labels } = await ship(plan({ waves }), {
    'wave 1 merge': prompt => {
      merged = true
      return standard('wave 1 merge', prompt)
    },
  }, budget)
  assert.ok(!labels.includes('wave 2 contract'))
  assert.ok(!labels.some(label => label.startsWith('gate')))
  assert.match(result.stopped, /before wave 2/)
  assert.deepEqual(result.notShipped.map(lane => lane.id), ['score'])
  assert.equal(result.outcome, 'PARTIAL')
})
