// The ship workflow's control flow, with every agent faked.
// Run: node --test plugins/shipwright/tests/ship.test.mjs
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
    // A second wave, so wave 1 gets a review of its own (a one-wave goal leaves it to the final review).
    { lanes: [{ id: 'docs', issues: ['GAME-9'], doneWhen: ['the README lists the controls'], owns: ['README.md'], kind: 'docs' }] },
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
    const ids = matches(prompt, /^Lane (\S+) \(/gm)
    return { sha: 'contract-sha', lanes: Object.fromEntries(ids.map(id => [id, { files: [`tests/${id}.test.ts`], untestable: [] }])) }
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
  assert.match(result.error, /needs repo, branch, base, brief/)
  assert.equal(calls.length, 0)
})

test('a clean run writes the contract first, ships every lane and ends DONE', async () => {
  const { result, labels, prompt } = await ship(plan())
  assert.equal(result.outcome, 'DONE')
  assert.deepEqual(result.shipped.map(lane => lane.id), ['board', 'input', 'docs'])
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
  assert.match(prompt('wave 1 contract'), /a missing module or export counts; a syntax, type or config error in the tests themselves doesn't\./)
  assert.match(prompt('wave 1 contract'), /Write no feature code and change no config\./)
  assert.match(prompt('wave 1 contract'), /never assert a page-wide count or that an element is the only one of its role/)
  assert.match(prompt('wave 1 contract'), /don't install or fetch one to run them/)
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
  const byType = type => calls.filter(call => call.agentType === `shipwright:${type}`)
  for (const call of byType('implementer')) assert.deepEqual([call.model, call.effort], ['sonnet', 'medium'])
  for (const call of byType('reviewer')) assert.deepEqual([call.model, call.effort], ['opus', 'xhigh'])
  for (const call of byType('integrator')) assert.deepEqual([call.model, call.effort], [undefined, undefined])
  assert.ok(byType('implementer').length > 0 && byType('reviewer').length > 0 && byType('integrator').length > 0)

  const defaults = await ship(plan({ models: undefined }))
  for (const call of defaults.calls) assert.ok(!('model' in call) && !('effort' in call), call.label)
})

test('the screens are audited once, at the final gate, one auditor per area on the reviewer model', async () => {
  const ui = { reference: 'docs/design.png', standard: 'house', areas: [{ name: 'board' }, { name: 'menus' }] }
  const { calls, labels } = await ship(plan({ ui }), { 'gate 1': red('line clear is off by one', ['src/board.ts']) })
  const audits = calls.filter(call => call.agentType === 'shipwright:ui-auditor')
  assert.deepEqual(audits.map(call => call.label), ['the whole diff audit board', 'the whole diff audit menus'])
  for (const call of audits) assert.deepEqual([call.model, call.effort], ['opus', 'xhigh'])
  assert.ok(labels.includes('wave 1 review'))
})

test('a UI goal whose plan names no areas is still audited', async () => {
  const { labels } = await ship(plan({ ui: { areas: [] } }))
  assert.ok(labels.includes('the whole diff audit screens'))
})

test('a one-wave goal is reviewed and audited once, by the final review, which gets what the wave review would have', async () => {
  const waves = structuredClone(PLAN.waves.slice(0, 1))
  waves[0].lanes[0].ui = true
  waves[0].lanes[0].risk = 'high'
  const should = { severity: 'should', file: 'src/board.ts', problem: 'tick() allocates every frame', fix: 'reuse the buffer' }
  const { labels, prompt } = await ship(plan({ waves, ui: { areas: [] } }), { 'board review': { findings: [should] } })
  assert.ok(!labels.includes('wave 1 review'))
  assert.ok(!labels.includes('wave 1 audit screens'))
  assert.ok(labels.includes('the whole diff review'))
  assert.ok(labels.includes('the whole diff audit screens'))
  assert.match(prompt('the whole diff review'), /GAME-1: its pre-merge review noted: should src\/board\.ts — tick\(\) allocates every frame/)
})

test('UI audits without a design reference check the Done-when items at desktop and phone sizes', async () => {
  const { prompt } = await ship(plan({ ui: { areas: [{ name: 'board' }] } }))
  const audit = prompt('the whole diff audit board')
  assert.match(audit, /No design reference: the Done-when items about the screen are the reference/)
  assert.match(audit, /desktop \(1280×720\) and phone \(390×844\)/)
  assert.match(audit, /Issues and Done-when:\n- GAME-1: the board is 10x20/)
  assert.doesNotMatch(audit, /undefined/)
})

test('untested Done-when items, lane notes and outside edits reach the reviewers and the result', async () => {
  const { result, prompt } = await ship(plan(), {
    'wave 1 contract': {
      sha: 'contract-sha',
      lanes: {
        board: { files: ['tests/board.test.ts'], untestable: [{ item: 'the board is 10x20', why: 'it is measured in a real browser' }] },
        input: { files: ['tests/input.test.ts'], untestable: [] },
      },
    },
    'board build': prompt => ({ ...standard('board build', prompt), open: ['the HUD layout needs the renderer'] }),
    'board check': prompt => checked(prompt, { outsideFiles: ['tsconfig.json'] }),
  })
  const review = prompt('wave 1 review')
  assert.match(review, /GAME-1: no automated test proves this, so check it by hand: the board is 10x20 \(it is measured in a real browser\)/)
  assert.match(review, /GAME-1: the lane left a note: the HUD layout needs the renderer/)
  assert.match(review, /GAME-1: changed files outside its own: tsconfig\.json/)
  assert.match(prompt('the whole diff review'), /check each by hand:\n- GAME-1: the board is 10x20 \(it is measured in a real browser\)/)
  assert.deepEqual(result.untestable, ['GAME-1: the board is 10x20 (it is measured in a real browser)'])
  const board = result.lanes.find(lane => lane.id === 'board')
  assert.deepEqual([board.notes, board.outside], [['the HUD layout needs the renderer'], ['tsconfig.json']])
  assert.equal(result.outcome, 'DONE')
})

test("the contract writer's notes reach the lane, not the list of items to check by hand", async () => {
  const { result, prompt } = await ship(plan(), {
    'wave 1 contract': {
      sha: 'contract-sha',
      lanes: {
        board: { files: ['tests/board.contract.test.ts'], untestable: [], notes: ['the tests expect createBoard(rows, cols)'] },
        input: { files: ['tests/input.contract.test.ts'], untestable: [] },
      },
    },
  })
  assert.match(prompt('board build'), /From the contract's writer:\n- the tests expect createBoard\(rows, cols\)/)
  assert.doesNotMatch(prompt('input build'), /contract's writer/)
  assert.doesNotMatch(prompt('wave 1 review'), /createBoard/)
  assert.deepEqual(result.untestable, [])
  assert.equal(result.outcome, 'DONE')
})

test("the contract is keyed by lane id, and an untestable entry must be one of that lane's Done-when items", async () => {
  const { calls, prompt } = await ship(plan())
  const { lanes } = calls.find(call => call.label === 'wave 1 contract').schema.properties
  assert.deepEqual([lanes.type, lanes.required, lanes.additionalProperties], ['object', ['board', 'input'], false])
  const items = id => lanes.properties[id].properties.untestable.items.properties.item.enum
  assert.deepEqual(items('board'), ['the board is 10x20', 'a piece falls a row per tick'])
  assert.deepEqual(items('input'), ['arrow keys move the piece'])
  assert.match(prompt('wave 1 contract'), /Report each lane under its lane id \(the word after "Lane"\), not its issue keys\./)
  assert.match(prompt('wave 1 contract'), /Import only the lane's own files and code already on the branch, and build by hand any state another lane's code would make/)
})

test('a lane the contract has no entry for is logged and builds without contract tests', async () => {
  const { result, logs, prompt } = await ship(plan(), {
    'wave 1 contract': { sha: 'contract-sha', lanes: { board: { files: ['tests/board.test.ts'], untestable: [] } } },
  })
  assert.ok(logs.includes('Wave 1: the contract has no entry for input; those lanes run without contract tests.'))
  assert.match(prompt('board build'), /git checkout contract-sha -- tests\/board\.test\.ts/)
  assert.doesNotMatch(prompt('input build'), /Contract tests:/)
  assert.match(prompt('input check'), /contract: \[\] \(this lane has no contract tests\)\./)
  assert.equal(result.outcome, 'DONE')
})

test('fix lanes show under the round that made them, and a lane report must cover every item and name a commit', async () => {
  const finding = { severity: 'must', file: 'src/board.ts', problem: 'step() is not pure', fix: 'copy the queue' }
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
    ['docs', 'wave 2', true],
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

test("a lane's own tests count as its own, and another lane's tests as that lane's", async () => {
  const { result, prompt } = await ship(plan(), {
    'board check': (prompt, nth) => checked(prompt, { outsideFiles: nth === 1 ? ['src/board.test.ts', 'src/input.spec.ts'] : ['src/board.test.ts'] }),
  })
  assert.match(prompt('board build'), /\nOwn: src\/board\.ts, with their tests\./)
  assert.match(prompt('board fix 1'), /edited src\/input\.spec\.ts, which lane input owns/)
  assert.doesNotMatch(prompt('board fix 1'), /edited src\/board\.test\.ts/)
  assert.deepEqual(result.lanes.find(lane => lane.id === 'board').outside, [])
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
  assert.deepEqual(result.shipped.map(lane => lane.id), ['board', 'input', 'docs'])
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
  assert.match(prompt('input build again'), /Since you started, board merged into feat\/game: first bring that in with git merge feat\/game, its message in the brief's format\./)
  assert.doesNotMatch(prompt('wave 1 merge'), /lane-input/)
  assert.match(prompt('wave 1 second pass merge'), /lane-input/)
  assert.deepEqual(result.shipped.map(lane => lane.id), ['board', 'input', 'docs'])
  assert.equal(result.outcome, 'DONE')

  const stuck = await ship(plan(), {
    'input build': waits,
    'wave 1 merge': { head: 'h1', merged: [], failed: [{ id: 'board', why: 'conflict in package.json' }], checks: [OK] },
  })
  assert.ok(!stuck.labels.includes('input build again'))
  assert.equal(stuck.result.notShipped.find(lane => lane.id === 'input').why, "it waited for board, which didn't merge")
})

test("a lane that builds again keeps its first attempt's decisions, not its notes about waiting", async () => {
  const waits = { status: 'blocked', sha: '', files: [], doneWhen: [], checks: [], decisions: ['keys repeat after 150 ms'], open: ['needs the board API'], needs: ['board'] }
  const { result } = await ship(plan(), {
    'input build': waits,
    'input build again': prompt => ({ ...standard('input build again', prompt), decisions: ['moves go through board.move()'] }),
  })
  const input = result.lanes.find(lane => lane.id === 'input')
  assert.deepEqual([input.decisions, input.notes], [['keys repeat after 150 ms', 'moves go through board.move()'], []])
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
  const finding = (file, severity = 'must', security = false) => ({ severity, file, problem: `bug in ${file}`, fix: 'fix it', security })
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
    { severity: 'must', file: 'src/render.test.ts', problem: 'the test pins the clipped size', fix: 'expect the whole piece' },
    { severity: 'must', file: 'src/input.ts', problem: 'held keys repeat too fast', fix: 'add a delay' },
    { severity: 'must', file: 'src/hud.spec.ts', problem: 'the HUD test skips the preview', fix: 'cover it' },
  ]
  const { labels, prompt } = await ship(plan(), { 'wave 1 review': { findings } })
  assert.deepEqual(fixBuilds(labels), ['wave-1-review-fix1 build', 'wave-1-review-fix2 build'])
  assert.match(prompt('wave-1-review-fix1 build'), /\nOwn: src\/render\.ts, src\/hud\.ts, src\/render\.test\.ts, src\/hud\.spec\.ts, with their tests\./)
  assert.match(prompt('wave-1-review-fix2 build'), /\nOwn: src\/input\.ts, with their tests\./)

  // A finding that spans two groups joins them.
  const spans = { severity: 'must', file: 'src/input.test.ts', files: ['src/input.test.ts', 'src/hud.ts'], problem: 'p', fix: 'f' }
  const joined = await ship(plan(), { 'wave 1 review': { findings: [...findings, spans] } })
  assert.deepEqual(fixBuilds(joined.labels), ['wave-1-review-fix1 build'])
})

test('a fix lane names the issues of the lanes whose files it changes', async () => {
  const findings = [
    { severity: 'must', file: 'src/board.test.ts', problem: 'the test pins a 9-row board', fix: 'expect 20 rows' },
    { severity: 'must', file: 'docs/notes.md', problem: 'the notes are stale', fix: 'update them' },
  ]
  const { prompt } = await ship(plan(), { 'wave 1 review': { findings } })
  assert.match(prompt('wave-1-review-fix1 build'), /^Lane wave-1-review-fix1: GAME-1\./)
  assert.match(prompt('wave-1-review-fix2 build'), /^Lane wave-1-review-fix2: wave 1 review findings\./)
})

test('a fix lane that only touches docs needs no checks', async () => {
  const finding = { severity: 'must', file: 'README.md', problem: 'the controls are missing', fix: 'list them' }
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
    { severity: 'must', file: 'src/board.ts', problem: 'step() is not pure', fix: 'copy the queue' },
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

test("fix lanes' notes and edits outside their files reach the final review", async () => {
  const finding = { severity: 'must', file: 'src/board.ts', problem: 'step() is not pure', fix: 'copy the queue' }
  const { prompt } = await ship(plan(), {
    'wave 1 review': { findings: [finding] },
    'wave-1-review-fix1 build': prompt => ({ ...standard('wave-1-review-fix1 build', prompt), open: ['the HUD reads the queue too'] }),
    'wave-1-review-fix1 check': prompt => checked(prompt, { outsideFiles: ['src/hud.ts', 'src/board.test.ts'] }),
  })
  const final = prompt('the whole diff review')
  assert.match(final, /\n- GAME-1: the lane left a note: the HUD reads the queue too/)
  assert.match(final, /\n- GAME-1: changed files outside its own: src\/hud\.ts; check each change is needed/)
})

test('the result lists the findings each round fixed', async () => {
  const must = { severity: 'must', file: 'src/board.ts', problem: 'rows never clear', fix: 'scan every row' }
  const should = { severity: 'should', file: 'src/input.ts', problem: 'held keys repeat too fast', fix: 'add a delay' }
  const { result, prompt } = await ship(plan(), {
    'wave 1 review': { findings: [must] },
    'gate 1': red('line clear is off by one', ['src/board.ts']),
    'the whole diff review': { findings: [should] },
  })
  const gateFix = 'must src/board.ts — line clear is off by one — fix: root-cause and fix it; prove a flaky fix with about 10 repeats'
  assert.deepEqual(result.fixed, [
    'must src/board.ts — rows never clear — fix: scan every row',
    gateFix,
    'should src/input.ts — held keys repeat too fast — fix: add a delay',
  ])
  assert.ok(listAfter(prompt('the whole diff review'), 'Earlier rounds fixed these').includes(gateFix))
  assert.equal(result.outcome, 'DONE')
})

test('a wave review knows what later waves still build', async () => {
  const waves = [...structuredClone(PLAN.waves), { lanes: [{ id: 'hud', issues: ['GAME-7'], doneWhen: ['the score shows beside the board'], owns: ['src/hud.ts'] }] }]
  const { result, prompt } = await ship(plan({ waves }))
  assert.match(prompt('wave 1 review'), /Later waves still build these, so don't report them as missing:\n- GAME-9: the README lists the controls\n- GAME-7: the score shows beside the board/)
  assert.doesNotMatch(prompt('wave 3 review'), /Later waves/)
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
  const budget = { total: 1_000_000, spent: () => 990_000, remaining: () => (merged ? 10_000 : 900_000) }
  const { result, labels } = await ship(plan({ waves }), {
    'wave 1 merge': prompt => {
      merged = true
      return standard('wave 1 merge', prompt)
    },
  }, budget)
  assert.ok(!labels.includes('wave 2 contract'))
  assert.ok(!labels.some(label => label.startsWith('gate')))
  assert.match(result.stopped, /before wave 2/)
  assert.equal(result.tokens, 990_000)
  assert.deepEqual(result.notShipped.map(lane => lane.id), ['docs', 'score'])
  assert.equal(result.outcome, 'PARTIAL')
})

test('a re-check that dies is asked again, not turned into a rebuild', async () => {
  const { result, labels } = await ship(plan(), { 'board check': null, 'board check again': prompt => checked(prompt) })
  assert.ok(labels.includes('board check again'))
  assert.ok(!labels.includes('board fix 1'))
  assert.equal(result.outcome, 'DONE')
})

test('a lane whose re-check dies twice is dropped, with no rebuild', async () => {
  const { result, labels } = await ship(plan(), { 'board check': null, 'board check again': null })
  assert.ok(!labels.includes('board fix 1'))
  assert.deepEqual(result.notShipped, [{ id: 'board', issues: ['GAME-1'], why: 'the claims could not be re-checked' }])
})

test('a high-risk lane whose pre-merge review dies merges, and the wave review starts with it', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].risk = 'high'
  const { result, logs, prompt } = await ship(plan({ waves }), { 'board review': null })
  assert.ok(logs.includes('Lane board: its pre-merge review did not run.'))
  assert.match(prompt('wave 1 review'), /GAME-1: its pre-merge review noted: should lane-board — its high-risk pre-merge review did not run/)
  assert.equal(result.outcome, 'DONE')
})

test('an agent that throws in one wave stops the waves after it', async () => {
  const waves = [...structuredClone(PLAN.waves), { lanes: [{ id: 'score', issues: ['GAME-3'], doneWhen: ['a line scores 100'], owns: ['src/score.ts'] }] }]
  const { result, labels } = await ship(plan({ waves }), {
    'wave 1 review': () => {
      throw new Error('token budget spent')
    },
  })
  assert.ok(!labels.includes('wave 2 contract'))
  assert.ok(!labels.some(label => label.startsWith('gate')))
  assert.equal(result.outcome, 'PARTIAL')
})

test("a red gate's last failures and its unmerged fixes reach the result", async () => {
  const twoRed = { head: 'gate-head', checks: [{ ...OK, pass: false, counts: '2 failed' }], failures: [
    { problem: 'line clear is off by one', files: ['src/board.ts'] },
    { problem: 'score overflows at 1e6', files: ['src/score.ts'] },
  ] }
  const { result } = await ship(plan(), {
    'gate 1': twoRed,
    'gate-1-fix2 check': failing('1 failed'),
    'gate 2': red('score overflows at 1e6', ['src/score.ts']),
    'gate 3': red('score overflows at 1e6', ['src/score.ts']),
  })
  assert.ok(result.open.some(line => /score overflows at 1e6/.test(line)))
  assert.deepEqual(result.gate.failures, [{ problem: 'score overflows at 1e6', files: ['src/score.ts'] }])
  assert.equal(result.outcome, 'PARTIAL')
})

test('a plan with lanes that would collide mid-build is sent back before any agent runs', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[1].id = 'board'
  waves[0].lanes[1].doneWhen = []
  waves[1].lanes[0].issues = undefined
  const { result, calls } = await ship(plan({ waves }))
  assert.equal(calls.length, 0)
  assert.equal(result.outcome, 'BLOCKED')
  assert.match(result.error, /lane id board is used twice/)
  assert.match(result.error, /lane board has no doneWhen/)
  assert.match(result.error, /lane docs has no issues/)
})

test('lanes of one wave may not own the same files, a folder and a file in it, or a file and its tests', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].owns = ['src/game']
  waves[0].lanes[1].owns = ['src/game/input.ts', 'src/score.ts']
  waves[0].lanes.push({ id: 'score', issues: ['GAME-3'], doneWhen: ['a line scores 100'], owns: ['src/score.test.ts'] })
  const { result, calls } = await ship(plan({ waves }))
  assert.equal(calls.length, 0)
  assert.match(result.error, /lanes board and input of wave 1 both own src\/game\/input\.ts; move one to a later wave/)
  assert.match(result.error, /lanes input and score of wave 1 both own src\/score\.ts, src\/score\.test\.ts/)
  assert.doesNotMatch(result.error, /lanes board and score/)
})

test('the same files in different waves are fine, and so is a wave with no lanes reported', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[1].lanes[0].owns = ['src/board.ts']
  assert.equal((await ship(plan({ waves }))).result.error, undefined)
  const empty = await ship(plan({ waves: [...structuredClone(PLAN.waves), { lanes: [] }] }))
  assert.match(empty.result.error, /wave 3 has no lanes/)
})

test('a wave review fixes only must and security findings; the rest wait for the whole-diff review', async () => {
  const must = { severity: 'must', file: 'src/board.ts', problem: 'rows never clear', fix: 'scan every row' }
  const should = { severity: 'should', file: 'src/input.ts', problem: 'held keys repeat too fast', fix: 'add a delay' }
  const { result, prompt } = await ship(plan(), { 'wave 1 review': { findings: [must, should] } })
  assert.doesNotMatch(prompt('wave-1-review-fix1 build'), /held keys/)
  assert.equal(prompt('wave-1-review-fix2 build'), '')
  assert.match(prompt('the whole diff review'), /left these open; report each one that still holds again:\n- should src\/input\.ts — held keys repeat too fast/)
  assert.equal(result.reviews[0].open, 1)
  assert.equal(result.outcome, 'DONE')
})

test("the next wave's contract is written while this wave is reviewed", async () => {
  const waves = [...structuredClone(PLAN.waves.slice(0, 1)), { lanes: [{ id: 'hud', issues: ['GAME-7'], doneWhen: ['the score shows'], owns: ['src/hud.ts'] }] }]
  const { labels } = await ship(plan({ waves }))
  assert.ok(labels.indexOf('wave 1 merge') < labels.indexOf('wave 2 contract'))
  assert.ok(labels.indexOf('wave 2 contract') < labels.indexOf('wave 1 review'))
})

test('a high-risk lane alone in its wave skips the pre-merge review: the wave review comes right after', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[1].lanes[0] = { id: 'score', issues: ['GAME-3'], doneWhen: ['a line scores 100'], owns: ['src/score.ts'], risk: 'high' }
  waves.push({ lanes: [{ id: 'docs', issues: ['GAME-9'], doneWhen: ['the README lists the controls'], owns: ['README.md'], kind: 'docs' }] })
  const { labels } = await ship(plan({ waves }))
  assert.ok(!labels.includes('score review'))
  assert.ok(labels.includes('wave 2 review'))
})

test('a lane held back only by its pre-merge review merges after its retries, and the findings get fix lanes', async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].risk = 'high'
  const must = { severity: 'must', file: 'src/board.ts', line: 40, problem: 'the screen reader hears ids', fix: 'announce titles' }
  const { result, logs, prompt } = await ship(plan({ waves }), { 'board review': { findings: [must] } })
  assert.ok(logs.includes("Lane board merges with 1 pre-merge findings for the wave's fix lanes."))
  assert.ok(result.shipped.some(lane => lane.id === 'board'))
  assert.match(prompt('wave-1-review-fix1 build'), /must src\/board\.ts:40 — the screen reader hears ids/)
  assert.equal(result.outcome, 'DONE')
})

test("a lane after one that didn't ship may leave the items that need it, and no one chases them", async () => {
  const waves = [...structuredClone(PLAN.waves), { lanes: [{ id: 'motion', issues: ['GAME-7'], doneWhen: ['pieces glide', 'a cleared row fades'], owns: ['src/motion.ts'] }] }]
  const { result, prompt } = await ship(plan({ waves }), {
    'input check': failing('1 failed'),
    'motion build': prompt => {
      const report = standard('motion build', prompt)
      report.doneWhen[0] = { ...report.doneWhen[0], met: false, proof: 'needs input: gliding follows the arrow keys' }
      return report
    },
  })
  assert.match(prompt('wave 3 contract'), /These earlier lanes didn't ship: input \(GAME-2\)/)
  assert.match(prompt('motion build'), /These earlier lanes didn't ship: input \(GAME-2\)\. Report a Done-when item/)
  assert.ok(result.shipped.some(lane => lane.id === 'motion'))
  assert.deepEqual(result.blocked, ['GAME-7: pieces glide (needs input: gliding follows the arrow keys)'])
  assert.match(prompt('the whole diff review'), /These lanes didn't ship, so don't report what only they would build: input \(GAME-2\)\./)
  assert.match(prompt('the whole diff review'), /Left unmet because a lane they need didn't ship; don't report these:\n- GAME-7: pieces glide/)
  assert.equal(result.outcome, 'PARTIAL')
})

test('an unmet item that names a lane that did ship is still a gap', async () => {
  const { labels } = await ship(plan(), {
    'board build': (prompt, nth) => {
      const report = standard('board build', prompt)
      if (nth === 1) report.doneWhen[0] = { ...report.doneWhen[0], met: false, proof: 'needs input' }
      return report
    },
  })
  assert.ok(labels.includes('board fix 1'))
})

test("a fix lane may leave a finding it won't fix; it merges and that finding stays open", async () => {
  const musts = [
    { severity: 'must', file: 'src/board.ts', problem: 'rows never clear', fix: 'scan every row' },
    { severity: 'must', file: 'src/board.ts', line: 90, problem: 'the reorder settle has no animation', fix: 'animate it' },
  ]
  const wontFix = k => (label => prompt => {
    const report = standard(label, prompt)
    report.doneWhen[k] = { ...report.doneWhen[k], met: false, proof: "won't fix: reorder is not on this branch" }
    return report
  })
  const { result } = await ship(plan(), {
    'wave 1 review': { findings: musts },
    'wave-1-review-fix1 build': wontFix(1)('wave-1-review-fix1 build'),
    'the whole diff review': { findings: [musts[1]] },
    'final-review-fix1 build': wontFix(0)('final-review-fix1 build'),
  })
  assert.equal(result.lanes.find(lane => lane.id === 'wave-1-review-fix1').merged, true)
  assert.deepEqual(result.fixed.slice(0, 1), ['must src/board.ts — rows never clear — fix: scan every row'])
  const left = 'must src/board.ts:90 — the reorder settle has no animation — fix: animate it'
  assert.deepEqual(result.open, [left])
  assert.deepEqual(result.gate.failures, [{ problem: left, files: ['src/board.ts'] }])
  assert.equal(result.gate.green, true)
  assert.equal(result.outcome, 'PARTIAL')
})

test("a failure outside the lane that fails on the branch too doesn't drop it; the final gate gets it", async () => {
  const flaky = { cmd: 'npx playwright test', pass: false, counts: '47 passed, 1 failed (theme.spec.ts)', foreign: true }
  const { result, labels, prompt } = await ship(plan(), {
    'input build': prompt => ({ ...standard('input build', prompt), checks: [OK, flaky] }),
    'input check': prompt => checked(prompt, { checks: [{ ...OK, matchesReport: true }, { ...flaky, matchesReport: true }] }),
  })
  assert.match(prompt('input check'), /mark the check foreign: true/)
  assert.ok(!labels.includes('input fix 1'))
  assert.deepEqual(result.foreign, ['input: npx playwright test (47 passed, 1 failed (theme.spec.ts))'])
  assert.equal(result.outcome, 'DONE')
})

test("a branch with no remote isn't pushed", async () => {
  assert.match((await ship(plan())).prompt('wave 1 merge'), /Push the branch\./)
  const local = await ship(plan({ push: false }))
  assert.match(local.prompt('wave 1 merge'), /Don't push: the branch stays local\./)
  assert.doesNotMatch(local.prompt('wave 1 merge'), /Push the branch/)
})

test("a lane's own model and effort override the run's for its builds, not for the contract or its re-check", async () => {
  const waves = structuredClone(PLAN.waves)
  waves[0].lanes[0].model = 'opus'
  waves[0].lanes[0].effort = 'high'
  waves[0].lanes[1].model = 'haiku'
  const { calls } = await ship(plan({ waves }), { 'board check': (prompt, nth) => (nth === 1 ? failing('1 failed')(prompt) : checked(prompt)) })
  const of = label => calls.find(call => call.label === label)
  assert.deepEqual([of('board build').model, of('board build').effort], ['opus', 'high'])
  assert.deepEqual([of('board fix 1').model, of('board fix 1').effort], ['opus', 'high'])
  assert.deepEqual([of('input build').model, of('input build').effort], ['haiku', 'medium'])
  assert.deepEqual([of('wave 1 contract').model, of('board check').model], ['sonnet', undefined])
})

test('the same open finding reported by several rounds and auditors is listed once, the most severe kept', async () => {
  const csrf = line => ({ severity: 'nit', security: true, file: 'server/api.ts', line, problem: `restore can be called cross-site (${line})`, fix: 'check Origin' })
  const click = { severity: 'should', file: 'src/TaskRow.tsx', line: 74, problem: 'leaving rows take clicks', fix: 'make them inert' }
  const { result } = await ship(plan({ ui: { areas: [{ name: 'list' }] } }), {
    'the whole diff review': { findings: [csrf(92), csrf(94), click] },
    'the whole diff audit list': { findings: [{ ...click, severity: 'must', line: 75 }, csrf(93)] },
    'final-review-fix1 check': failing('1 failed'),
    'final-review-fix2 check': failing('1 failed'),
  })
  assert.deepEqual(result.open, [
    'must src/TaskRow.tsx:75 — leaving rows take clicks — fix: make them inert',
    'nit (security) server/api.ts:92 — restore can be called cross-site (92) — fix: check Origin',
  ])
  assert.deepEqual(result.security, ['nit (security) server/api.ts:92 — restore can be called cross-site (92) — fix: check Origin'])
})
