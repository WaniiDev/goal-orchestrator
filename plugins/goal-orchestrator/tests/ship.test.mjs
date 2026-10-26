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
const BLOB = 'a'.repeat(40)

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

// The "- " items under the first line that starts with heading.
function listAfter(prompt, heading) {
  const lines = prompt.split('\n')
  const start = lines.findIndex(line => line.startsWith(heading))
  const items = []
  if (start === -1) return items
  for (let i = start + 1; i < lines.length && lines[i].startsWith('- '); i++) items.push(lines[i].slice(2))
  return items
}

// What a re-check reports for the contract files its prompt lists; an edited file has another id at HEAD.
const contractOf = (prompt, edited = []) =>
  listAfter(prompt, 'contract: for each').map(file => ({ file, atContract: BLOB, atHead: edited.includes(file) ? 'b'.repeat(40) : BLOB }))
const checked = (prompt, changes = {}) => ({ checks: [{ ...OK, matchesReport: true }], contract: contractOf(prompt), clean: true, outsideFiles: [], ...changes })
const failing = counts => prompt => checked(prompt, { checks: [{ ...OK, pass: false, counts, matchesReport: true }] })

// What a well-behaved agent returns, by the label the workflow gives it.
function standard(label, prompt) {
  if (label.endsWith(' contract')) {
    return { sha: 'contract-sha', lanes: matches(prompt, /^Lane (\S+) \(/gm).map(id => ({ id, files: [`tests/${id}.test.ts`], untestable: [] })) }
  }
  if (/ (build|build again|fix \d+)$/.test(label)) {
    const items = listAfter(prompt, 'Done when:')
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
  if (label.endsWith(' check')) return checked(prompt)
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
const fixBuilds = labels => labels.filter(label => /^wave-1-review-fix\d build$/.test(label))

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
  assert.ok(!labels.some(label => /fix|again|second pass/.test(label)))
  assert.match(prompt('board build'), /git checkout contract-sha -- tests\/board\.test\.ts and commit them/)
  assert.doesNotMatch(prompt('board build'), /input\.test/)
  assert.match(prompt('board build'), /Building alongside you: input \(src\/input\.ts\)\. If you can't finish without one of them, report blocked with its id in needs\./)
  assert.match(prompt('board build'), /Report at least these checks: npm run typecheck · npm test\./)
  assert.match(prompt('wave 1 contract'), /worktree add -b contract-wave-1/)
  assert.match(prompt('wave 1 contract'), /no dynamic imports, type copies or any-casts/)
  assert.match(
    prompt('wave 1 contract'),
    /a missing module or export counts; a syntax, type or config error in the tests themselves doesn't\. Write no feature code and change no config\./,
  )
  assert.doesNotMatch(prompt('wave 1 contract'), /typecheck/)
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

test('a UI goal whose plan names no areas is still audited', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].ui = true
  const { labels } = await ship(plan({ waves, ui: { areas: [] } }))
  assert.ok(labels.includes('wave 1 audit screens'))
  assert.ok(labels.includes('the whole diff audit screens'))
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
    'board check': prompt => checked(prompt, { outsideFiles: ['tsconfig.json'] }),
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

test("the contract writer's notes reach the lane, not the list of items to check by hand", async () => {
  const { result, prompt } = await ship(plan(), {
    'wave 1 contract': {
      sha: 'contract-sha',
      lanes: [
        { id: 'board', files: ['tests/board.contract.test.ts'], untestable: [], notes: ['the tests expect createBoard(rows, cols)'] },
        { id: 'input', files: ['tests/input.contract.test.ts'], untestable: [] },
      ],
    },
  })
  assert.match(prompt('board build'), /From the contract's writer:\n- the tests expect createBoard\(rows, cols\)/)
  assert.doesNotMatch(prompt('input build'), /contract's writer/)
  assert.doesNotMatch(prompt('wave 1 review'), /createBoard/)
  assert.deepEqual(result.untestable, [])
  assert.equal(result.outcome, 'DONE')
})

test('fix lanes show under the round that made them, and a lane report must cover every item and name a commit', async () => {
  const finding = { severity: 'should', file: 'src/board.ts', problem: 'step() is not pure', fix: 'copy the queue' }
  const { result, calls } = await ship(plan(), {
    'wave 1 review': { findings: [finding] },
    'gate 1': red('line clear is off by one', ['src/board.ts']),
  })
  const phaseOf = label => calls.find(call => call.label === label)?.phase
  assert.deepEqual(
    ['board build', 'board check', 'wave-1-review-fix1 build', 'wave-1-review-fix1 check', 'gate-1-fix1 build'].map(phaseOf),
    ['Build', 'Build', 'Review', 'Review', 'Final gate'],
  )
  assert.deepEqual(result.lanes.map(lane => [lane.id, lane.round, lane.merged]), [
    ['board', 'wave 1', true],
    ['input', 'wave 1', true],
    ['wave-1-review-fix1', 'wave 1 review', true],
    ['gate-1-fix1', 'gate 1', true],
  ])
  const { schema } = calls.find(call => call.label === 'board build')
  assert.deepEqual([schema.properties.doneWhen.minItems, schema.properties.doneWhen.maxItems], [2, 2])
  const sha = new RegExp(schema.properties.sha.pattern)
  assert.ok(sha.test('411d9b3') && sha.test('') && !sha.test('see-below'))
})

test('heads and shas that go into git commands are bare hashes', async () => {
  const { calls } = await ship(plan())
  const pattern = (label, field) => new RegExp(calls.find(call => call.label === label).schema.properties[field].pattern)
  for (const head of [pattern('wave 1 merge', 'head'), pattern('gate 1', 'head')]) {
    assert.ok(head.test('179c659') && !head.test('179c659 (feat/block-drop)') && !head.test(''))
  }
  const contract = pattern('wave 1 contract', 'sha')
  assert.ok(contract.test('520172b') && contract.test('') && !contract.test('commit 520172b'))
})

test('a re-check reports the object ids of each contract file, for code to compare', async () => {
  const { calls } = await ship(plan())
  const { schema } = calls.find(call => call.label === 'board check')
  const contract = schema.properties.contract
  assert.deepEqual(schema.required, ['checks', 'contract', 'clean', 'outsideFiles'])
  assert.deepEqual([contract.minItems, contract.maxItems], [1, 1])
  const id = new RegExp(contract.items.properties.atHead.pattern)
  assert.ok(id.test(BLOB) && id.test('') && !id.test('411d9b3') && !id.test('untouched'))
})

test('a claim that does not re-run gets a fix attempt with the exact gap', async () => {
  const { result, prompt } = await ship(plan(), {
    'board check': (prompt, nth) => (nth === 1 ? checked(prompt, { checks: [{ ...OK, counts: '9 passed', matchesReport: false }] }) : checked(prompt)),
  })
  assert.match(prompt('board fix 1'), /re-run counts differ from the report: npm test \(9 passed\)/)
  assert.equal(result.lanes.find(lane => lane.id === 'board').attempts, 2)
  assert.equal(result.outcome, 'DONE')
})

test("edited contract tests and edits to another lane's files block the merge", async () => {
  const { prompt } = await ship(plan(), {
    'board check': (prompt, nth) =>
      nth === 1
        ? checked(prompt, { contract: contractOf(prompt, ['tests/board.test.ts']), outsideFiles: ['src/input.ts', 'README.md'] })
        : checked(prompt),
  })
  assert.match(prompt('board fix 1'), /contract tests were edited or left out: tests\/board\.test\.ts; bring them back unchanged/)
  assert.match(prompt('board fix 1'), /edited src\/input\.ts, which lane input owns/)
  assert.doesNotMatch(prompt('board fix 1'), /README/)
})

test('re-checks report what git prints, and change nothing', async () => {
  const check = (await ship(plan())).prompt('board check')
  assert.match(check, /contract: for each file below, what git rev-parse contract-sha:<file> and git rev-parse HEAD:<file> print:\n- tests\/board\.test\.ts/)
  assert.match(check, /clean: git status --porcelain \| wc -l prints 0/)
  assert.match(check, /outside src\/board\.ts, tests\/board\.test\.ts\./)
  assert.match(check, /Change nothing there: no edits, copied files, stashes or checkouts\./)
  assert.doesNotMatch(check, /prints nothing/)
})

test('an edit inside a directory another lane owns blocks the merge', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].owns = ['src/board/']
  waves[0].lanes[1].owns = ['src/input', 'tests']
  const outsideFiles = ['src/input/keys.ts', 'src\\input\\map.ts', 'src/inputs.ts', 'tests/board.test.ts']
  const { prompt } = await ship(plan({ waves }), {
    'board check': (prompt, nth) => (nth === 1 ? checked(prompt, { outsideFiles }) : checked(prompt)),
  })
  assert.match(prompt('board fix 1'), /edited src\/input\/keys\.ts, which lane input owns/)
  assert.match(prompt('board fix 1'), /edited src\\input\\map\.ts, which lane input owns/)
  assert.doesNotMatch(prompt('board fix 1'), /src\/inputs\.ts/)
  // The lane's own contract tests are its own, wherever they live.
  assert.doesNotMatch(prompt('board fix 1'), /edited tests\/board\.test\.ts/)
})

test('a report that already shows a gap goes back to the lane without a re-check', async () => {
  const { labels, prompt } = await ship(plan(), {
    'board build': prompt => ({ ...standard('board build', prompt), checks: [{ ...OK, pass: false, counts: '1 failed' }] }),
  })
  assert.deepEqual(labels.filter(label => label.startsWith('board ')), ['board build', 'board fix 1', 'board check'])
  assert.match(prompt('board fix 1'), /check failing: npm test \(1 failed\)/)

  const silent = await ship(plan(), { 'board build': prompt => ({ ...standard('board build', prompt), checks: [] }) })
  assert.match(silent.prompt('board fix 1'), /the lane reported no checks/)
})

test('a lane that keeps failing is dropped after its retries and the run is PARTIAL', async () => {
  const { result, labels, prompt } = await ship(plan(), { 'input check': failing('2 failed') })
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
    'board check': (prompt, nth) => (nth === 1 ? checked(prompt, { checks: [] }) : checked(prompt)),
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

test('a lane that needs another lane of its wave builds again once that one merges', async () => {
  const waits = { status: 'blocked', sha: '', files: [], doneWhen: [], checks: [], open: ['needs the board API'], needs: ['board'] }
  const { result, labels, prompt } = await ship(plan(), { 'input build': waits })
  assert.ok(labels.indexOf('input build again') > labels.indexOf('wave 1 merge'))
  assert.match(prompt('input build again'), /Since you started, board merged into feat\/game: first bring that in with git merge feat\/game\./)
  assert.doesNotMatch(prompt('wave 1 merge'), /lane-input/)
  assert.match(prompt('wave 1 second pass merge'), /lane-input/)
  assert.deepEqual(result.shipped.map(lane => lane.id), ['board', 'input'])
  assert.equal(result.outcome, 'DONE')

  const stuck = await ship(plan(), {
    'input build': waits,
    'wave 1 merge': { head: 'h1', merged: [], failed: [{ id: 'board', why: 'conflict in package.json' }], checks: [OK] },
  })
  assert.ok(!stuck.labels.includes('input build again'))
  assert.equal(stuck.result.notShipped.find(lane => lane.id === 'input').why, "it waited for board, which didn't merge")
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

test('what a pre-merge review lets pass reaches the wave review', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].risk = 'high'
  const should = { severity: 'should', file: 'src/board.ts', problem: 'tick() allocates every frame', fix: 'reuse the buffer' }
  const { result, labels, prompt } = await ship(plan({ waves }), { 'board review': { findings: [should] } })
  assert.ok(!labels.includes('board fix 1'))
  assert.match(prompt('wave 1 review'), /GAME-1: its pre-merge review noted: should src\/board\.ts — tick\(\) allocates every frame — fix: reuse the buffer/)
  assert.equal(result.outcome, 'DONE')
})

test('review findings become at most four fix lanes grouped by file; nits are skipped unless security', async () => {
  const finding = (file, severity = 'should', security = false) => ({ severity, file, problem: `bug in ${file}`, fix: 'fix it', security })
  const findings = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map(file => finding(file))
  findings.push(finding('f.ts', 'nit'), finding('g.ts', 'nit', true), finding('a.ts', 'must'))
  const { result, labels, logs, calls } = await ship(plan(), { 'wave 1 review': { findings } })
  assert.equal(fixBuilds(labels).length, 4)
  assert.ok(logs.some(line => /findings in 6 groups of files share 4 fix lanes/.test(line)))
  const fixPrompts = calls.filter(call => /^wave-1-review-fix\d build$/.test(call.label)).map(call => call.prompt).join('\n')
  assert.doesNotMatch(fixPrompts, /bug in f\.ts/)
  assert.match(fixPrompts, /should \(security\) g\.ts|nit \(security\) g\.ts/)
  assert.match(fixPrompts, /must a\.ts — bug in a\.ts/)
  assert.deepEqual(result.reviews[0], { round: 'wave 1', findings: 8, actionable: 7, open: 0, nits: ['nit f.ts — bug in f.ts — fix: fix it'] })
  assert.equal(result.outcome, 'DONE')
})

test('a source file and its tests go to one fix lane, which owns every file its findings name, as repo paths', async () => {
  const findings = [
    { severity: 'must', file: '/repo/src/render.ts', files: ['/repo/src/render.ts', 'src/hud.ts'], problem: 'the preview is clipped', fix: 'size it to the piece' },
    { severity: 'should', file: 'src/render.test.ts', problem: 'the test pins the clipped size', fix: 'expect the whole piece' },
    { severity: 'should', file: 'src/input.ts', problem: 'held keys repeat too fast', fix: 'add a delay' },
    { severity: 'should', file: 'src/hud.spec.ts', problem: 'the HUD test skips the preview', fix: 'cover it' },
  ]
  const { labels, prompt } = await ship(plan(), { 'wave 1 review': { findings } })
  assert.deepEqual(fixBuilds(labels), ['wave-1-review-fix1 build', 'wave-1-review-fix2 build'])
  assert.match(prompt('wave-1-review-fix1 build'), /\nOwn: src\/render\.ts, src\/hud\.ts, src\/render\.test\.ts, src\/hud\.spec\.ts\./)
  assert.match(prompt('wave-1-review-fix2 build'), /\nOwn: src\/input\.ts\./)

  // A finding that spans two groups joins them.
  const spans = { severity: 'should', file: 'src/input.test.ts', files: ['src/input.test.ts', 'src/hud.ts'], problem: 'p', fix: 'f' }
  const joined = await ship(plan(), { 'wave 1 review': { findings: [...findings, spans] } })
  assert.deepEqual(fixBuilds(joined.labels), ['wave-1-review-fix1 build'])
})

test('a fix lane that only touches docs needs no checks', async () => {
  const finding = { severity: 'should', file: 'README.md', problem: 'the controls are missing', fix: 'list them' }
  const { result, labels, prompt } = await ship(plan(), {
    'wave 1 review': { findings: [finding] },
    'wave-1-review-fix1 build': prompt => ({ ...standard('wave-1-review-fix1 build', prompt), checks: [] }),
  })
  assert.doesNotMatch(prompt('wave-1-review-fix1 build'), /Report at least these checks/)
  assert.ok(!labels.includes('wave-1-review-fix1 fix 1'))
  assert.equal(result.lanes.find(lane => lane.id === 'wave-1-review-fix1').merged, true)
  assert.equal(result.outcome, 'DONE')
})

test('the result keeps every fix lane with its decisions and notes, and the text of each nit', async () => {
  const findings = [
    { severity: 'should', file: 'src/board.ts', problem: 'step() is not pure', fix: 'copy the queue' },
    { severity: 'nit', file: 'src/input.ts', problem: 'a stray log', fix: 'drop it' },
  ]
  const { result } = await ship(plan(), {
    'wave 1 review': { findings },
    'wave-1-review-fix1 build': prompt => ({
      ...standard('wave-1-review-fix1 build', prompt),
      decisions: ['kept the queue immutable'],
      open: ['the HUD reads the queue too'],
    }),
  })
  assert.deepEqual(result.lanes.find(lane => lane.id === 'wave-1-review-fix1'), {
    id: 'wave-1-review-fix1',
    round: 'wave 1 review',
    status: 'ready',
    merged: true,
    attempts: 1,
    decisions: ['kept the queue immutable'],
    notes: ['the HUD reads the queue too'],
    outside: [],
  })
  assert.deepEqual(result.reviews[0].nits, ['nit src/input.ts — a stray log — fix: drop it'])
})

test('a fixed finding is closed, and the final review checks that the fix holds', async () => {
  const must = { severity: 'must', file: 'src/board.ts', problem: 'rows never clear', fix: 'scan every row' }
  const { result, prompt } = await ship(plan(), { 'wave 1 review': { findings: [must] } })
  assert.match(prompt('the whole diff review'), /Earlier rounds fixed these; check each fix holds:\n- must src\/board\.ts — rows never clear/)
  assert.doesNotMatch(prompt('the whole diff review'), /left these open/)
  assert.deepEqual(result.open, [])
  assert.equal(result.outcome, 'DONE')
})

test('a finding left open goes to the final review, which decides whether it still holds', async () => {
  const must = { severity: 'must', file: 'src/board.ts', problem: 'rows never clear', fix: 'scan every row' }
  const overrides = { 'wave 1 review': { findings: [must] }, 'wave-1-review-fix1 check': failing('1 failed') }
  const { result, prompt } = await ship(plan(), overrides)
  assert.match(prompt('the whole diff review'), /Earlier rounds left these open; report each one that still holds again:\n- must src\/board\.ts — rows never clear/)
  assert.deepEqual(result.open, [])
  assert.equal(result.outcome, 'DONE')

  // A final review that is missing an audit can't settle it, so it stays open.
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].ui = true
  const blind = await ship(plan({ waves, ui: { areas: [{ name: 'board' }] } }), { ...overrides, 'the whole diff audit board': null })
  assert.deepEqual(blind.result.open, ['must src/board.ts — rows never clear — fix: scan every row'])
  assert.equal(blind.result.outcome, 'PARTIAL')
})

test('a wave review knows what later waves still build', async () => {
  const waves = [...structuredClone(PLAN.waves), { lanes: [{ id: 'hud', issues: ['GAME-7'], doneWhen: ['the score shows beside the board'], owns: ['src/hud.ts'] }] }]
  const { result, prompt } = await ship(plan({ waves }))
  assert.match(prompt('wave 1 review'), /Later waves still build these, so don't report them as missing:\n- GAME-7: the score shows beside the board/)
  assert.doesNotMatch(prompt('wave 2 review'), /Later waves/)
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
  const { result, labels } = await ship(plan(), {
    'gate 1': red('score overflows at 1e6', ['src/score.ts']),
    'gate-1-fix1 check': failing('1 failed'),
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
