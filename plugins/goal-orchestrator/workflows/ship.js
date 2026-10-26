export const meta = {
  name: 'ship',
  description: 'Ship a planned goal on one branch: contract tests, lanes in waves, re-checked claims, merges, reviews and a final gate',
  whenToUse: 'Started by /goal-orchestrator:run with the plan it writes; not for direct use',
  phases: [
    { title: 'Contract', detail: 'failing acceptance tests from the Done-when items, before any code' },
    { title: 'Build', detail: 'one implementer per lane in its own worktree; every claim re-run' },
    { title: 'Merge', detail: 'ready lanes into the feature branch, fast checks, push' },
    { title: 'Review', detail: 'wave reviews, UI audits and fix lanes' },
    { title: 'Final gate', detail: 'full suites, whole-diff review, last fixes' },
  ],
}

// The run's control flow lives here, in code: what runs in what order, how
// often a lane may retry, and when the run stops. Agents do the work and
// report schema-checked JSON; every gate below is plain code over it.

const TYPE = {
  implementer: 'goal-orchestrator:implementer',
  reviewer: 'goal-orchestrator:reviewer',
  auditor: 'goal-orchestrator:ui-auditor',
  integrator: 'goal-orchestrator:integrator',
}
const MAX_FIX_LANES = 4
const RESERVE = 50_000
// A commit hash and nothing else: these values go straight into git commands and ranges.
const SHA = '^[0-9a-f]{7,40}$'
const SHA_OR_EMPTY = '^([0-9a-f]{7,40})?$'

const CHECK = {
  type: 'object',
  required: ['cmd', 'pass', 'counts'],
  properties: { cmd: { type: 'string' }, pass: { type: 'boolean' }, counts: { type: 'string' } },
}
const LANE = {
  type: 'object',
  required: ['status', 'sha', 'files', 'doneWhen', 'checks'],
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    sha: {
      type: 'string',
      pattern: SHA_OR_EMPTY,
      description: 'your last commit on the lane branch, made before this report (empty only if blocked before any commit)',
    },
    files: { type: 'array', items: { type: 'string' } },
    doneWhen: {
      type: 'array',
      description: 'one entry per Done-when item, in the order given',
      items: {
        type: 'object',
        required: ['item', 'met', 'proof'],
        properties: {
          item: { type: 'string' },
          met: { type: 'boolean' },
          proof: { type: 'string', description: 'the test or command that proves it' },
        },
      },
    },
    checks: { type: 'array', items: CHECK },
    decisions: { type: 'array', items: { type: 'string' } },
    open: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' }, description: 'around mode only: what only the user can decide' },
  },
}
// One Done-when entry per item: a short report fails at the tool call, not after a whole re-check and retry.
const laneSchema = lane => ({
  ...LANE,
  properties: { ...LANE.properties, doneWhen: { ...LANE.properties.doneWhen, minItems: lane.doneWhen.length } },
})
const VERIFY = {
  type: 'object',
  required: ['checks', 'contractUntouched', 'clean', 'outsideFiles'],
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['cmd', 'pass', 'counts', 'matchesReport'],
        properties: { ...CHECK.properties, matchesReport: { type: 'boolean' } },
      },
    },
    contractUntouched: { type: 'boolean' },
    clean: { type: 'boolean' },
    outsideFiles: { type: 'array', items: { type: 'string' } },
  },
}
const CONTRACT = {
  type: 'object',
  required: ['sha', 'lanes'],
  properties: {
    sha: { type: 'string', pattern: SHA_OR_EMPTY, description: 'the commit that adds the contract tests (empty if no item can be tested)' },
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'files', 'untestable'],
        properties: {
          id: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          untestable: { type: 'array', items: { type: 'string' }, description: 'Done-when items no automated test can prove, each with why' },
        },
      },
    },
  },
}
const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['must', 'should', 'nit'] },
          file: { type: 'string' },
          line: { type: 'number' },
          problem: { type: 'string', description: 'input → wrong result, or reference → what the screen shows' },
          fix: { type: 'string' },
          security: { type: 'boolean' },
        },
      },
    },
    checks: { type: 'array', items: CHECK },
  },
}
const MERGE = {
  type: 'object',
  required: ['head', 'merged', 'failed', 'checks'],
  properties: {
    head: { type: 'string', pattern: SHA, description: 'the feature branch head after the merges' },
    merged: { type: 'array', items: { type: 'string' }, description: 'the lanes now merged, by the id before each colon' },
    failed: {
      type: 'array',
      items: { type: 'object', required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } },
    },
    checks: { type: 'array', items: CHECK },
  },
}
const GATE = {
  type: 'object',
  required: ['head', 'checks', 'failures'],
  properties: {
    head: { type: 'string', pattern: SHA, description: 'the commit the gate ran on' },
    checks: { type: 'array', items: CHECK },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['problem', 'files'],
        properties: { problem: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
}

const plan = args
if (!plan || !plan.repo || !plan.branch || !plan.base || !plan.brief || !Array.isArray(plan.waves) || plan.waves.length === 0) {
  return {
    outcome: 'BLOCKED',
    summary: 'The ship workflow runs the plan /goal-orchestrator:run writes (repo, branch, base, brief, waves); start it from there.',
  }
}
const LIMITS = { laneRetries: 2, gateRounds: 2, ...(plan.limits || {}) }
const CHECKS = { fast: [], full: [], ...(plan.checks || {}) }
const FULL = CHECKS.full.length ? CHECKS.full : CHECKS.fast
const WHERE = `Main checkout ${plan.repo}, feature branch ${plan.branch}. Brief: ${plan.brief}. Mode: ${plan.mode || 'away'}.`
const NO_CONTRACT = { sha: '', lanes: [] }

const list = items => items.map(item => `- ${item}`).join('\n')
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const isCode = lane => (lane.kind || 'code') === 'code'
const actionable = finding => finding.severity !== 'nit' || finding.security === true
const describe = f =>
  `${f.severity}${f.security ? ' (security)' : ''} ${f.file}${f.line ? `:${f.line}` : ''} — ${f.problem} — fix: ${f.fix}`
const budgetLow = () => typeof budget !== 'undefined' && budget.total && budget.remaining() < RESERVE
const untestableOf = (contract, id) => ((contract.lanes || []).find(entry => entry.id === id) || {}).untestable || []
// owns lists files or directories; paths compare repo-relative, with forward slashes.
const normal = path => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
const ownsFile = (lane, file) => {
  const path = normal(file)
  return lane.owns.map(normal).some(entry => path === entry || path.startsWith(`${entry}/`))
}

// An agent call that throws (a spent token budget does) counts as no answer and
// stops the run, so the workflow still returns what it has.
async function call(prompt, options) {
  try {
    return await agent(prompt, options)
  } catch (error) {
    stopped = stopped || `${options.label} failed: ${String((error && error.message) || error)}`
    log(`Stopped: ${stopped}.`)
    return null
  }
}

function opts(role, label, phaseTitle, schema) {
  const models = plan.models || {}
  const choice = models[role] || (role === 'auditor' ? models.reviewer : undefined) || {}
  const options = { agentType: TYPE[role], label, phase: phaseTitle, schema }
  if (choice.model) options.model = choice.model
  if (choice.effort) options.effort = choice.effort
  return options
}

async function writeContract(wave, w) {
  const lanes = plan.contract === false ? [] : wave.lanes.filter(isCode)
  if (lanes.length === 0) return NO_CONTRACT
  const branch = `contract-wave-${w}`
  const tree = `${plan.repo}/.claude/worktrees/${branch}`
  const contract = await call(
    [
      `Write the acceptance contract for wave ${w}. ${WHERE}`,
      `Work in a throwaway worktree: git -C ${plan.repo} worktree add -b ${branch} ${tree} ${plan.branch} (if branch ${branch} already exists from an earlier attempt, add the worktree on it and check what it holds). For each Done-when item below that an automated test can prove, write a failing acceptance test in the repo's test layout, in files of each lane's own. Run them and confirm each fails only because the feature is missing: the test files themselves pass the repo's typecheck and lint under its config as it is. Write no feature code and change no config. List every item you can't test as untestable, with why.`,
      `Commit the tests on ${branch} as one commit in the brief's format ("Add acceptance tests for wave ${w}"). Don't push. Remove the worktree and keep the branch: each lane brings in only its own tests, so a lane that doesn't ship leaves no failing tests behind.`,
      ...lanes.map(lane => `Lane ${lane.id} (${lane.issues.join(', ')}), will own ${lane.owns.join(', ')}:\n${list(lane.doneWhen)}`),
    ].join('\n\n'),
    opts('implementer', `wave ${w} contract`, 'Contract', CONTRACT),
  )
  if (!contract) log(`Wave ${w}: the contract could not be written; its lanes run without one.`)
  return contract || NO_CONTRACT
}

function checkPrompt(lane, tree, tests, contract, report) {
  return [
    `Re-check lane ${lane.id} in ${tree} (branch lane-${lane.id}). Brief: ${plan.brief}. Change nothing.`,
    `Re-run each check the lane reported; matchesReport says whether your counts match:\n${list(
      (report.checks || []).map(c => `${c.cmd} → ${c.pass ? 'pass' : 'fail'}, ${c.counts}`),
    )}`,
    tests && tests.files.length
      ? `contractUntouched: git diff --quiet ${contract.sha} HEAD -- ${tests.files.join(' ')} exits 0.`
      : 'contractUntouched: true (this lane has no contract).',
    `clean: git status --porcelain | wc -l prints 0. outsideFiles: files in git diff --name-only ${plan.branch}...HEAD outside ${lane.owns.join(', ')}.`,
  ].join('\n')
}

// Plain code over the two reports: what still stands between the lane and a merge.
function laneGaps(lane, wave, report, check) {
  if (!report) return ['the implementer returned no report']
  const gaps = []
  const items = report.doneWhen || []
  if (items.length < lane.doneWhen.length) gaps.push(`the report covers ${items.length} of ${lane.doneWhen.length} Done-when items`)
  for (const item of items) if (!item.met) gaps.push(`Done-when not met: ${item.item}`)
  if (!(report.checks || []).length) gaps.push('the lane reported no checks')
  for (const c of report.checks || []) if (!c.pass) gaps.push(`check failing: ${c.cmd} (${c.counts})`)
  if (!check) {
    gaps.push('the claims could not be re-checked')
  } else {
    const reran = check.checks || []
    const claimed = report.checks || []
    if (reran.length < claimed.length) gaps.push(`only ${reran.length} of the ${claimed.length} reported checks could be re-run`)
    for (const c of reran) {
      if (!c.pass) gaps.push(`re-run failed: ${c.cmd} (${c.counts})`)
      else if (!c.matchesReport) gaps.push(`re-run counts differ from the report: ${c.cmd} (${c.counts})`)
    }
    if (!check.contractUntouched) gaps.push('contract tests were edited: restore them and make the code pass them')
    if (!check.clean) gaps.push('the worktree has uncommitted changes')
    for (const file of check.outsideFiles || []) {
      const owner = wave.lanes.find(other => other.id !== lane.id && ownsFile(other, file))
      if (owner) gaps.push(`edited ${file}, which lane ${owner.id} owns`)
    }
  }
  if (gaps.length === 0 && report.status !== 'done') {
    gaps.push(...((report.open || []).length ? report.open : ['the lane reported itself unfinished']))
  }
  return gaps
}

async function runLane(lane, wave, contract, phaseTitle = 'Build') {
  const tree = `${plan.repo}/.claude/worktrees/lane-${lane.id}`
  const tests = (contract.lanes || []).find(entry => entry.id === lane.id)
  const task = [
    `Lane ${lane.id}: ${lane.issues.join(', ')}. ${WHERE}`,
    `Worktree ${tree}, branch lane-${lane.id}. If it doesn't exist yet, create it: git -C ${plan.repo} worktree add -b lane-${lane.id} ${tree} ${plan.branch} (or, if branch lane-${lane.id} already exists, git -C ${plan.repo} worktree add ${tree} lane-${lane.id}).`,
    `Done when:\n${list(lane.doneWhen)}`,
    (lane.owns.length ? `Own: ${lane.owns.join(', ')}.` : 'Own: only the files this fix needs.') +
      (lane.avoid && lane.avoid.length ? ` Don't touch: ${lane.avoid.join(', ')}.` : ''),
    lane.db || lane.port ? `DB ${lane.db || 'none'}, port ${lane.port || 'none'}.` : '',
    lane.e2e ? `e2e filter: ${lane.e2e}` : '',
    tests && tests.files.length
      ? `Contract tests: unless your branch already has them, first bring in your own with git checkout ${contract.sha} -- ${tests.files.join(' ')} and commit them ("Add acceptance tests for ${lane.issues.join(', ')}"). Make them pass and never edit them.`
      : '',
    lane.answers && lane.answers.length ? `The user's answers:\n${list(lane.answers)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  let report = await call(task, opts('implementer', `${lane.id} build`, phaseTitle, laneSchema(lane)))
  for (let attempt = 1; ; attempt++) {
    if (plan.mode === 'around' && report && (report.questions || []).length) {
      return { id: lane.id, issues: lane.issues, status: 'questions', questions: report.questions, attempts: attempt }
    }
    // Blocked means outside the lane's reach (a secret, a service): a retry can't fix it.
    if (report && report.status === 'blocked') {
      const gaps = (report.open || []).length ? report.open : ['the lane reported itself blocked']
      log(`Lane ${lane.id} blocked: ${gaps[0]}`)
      return { id: lane.id, issues: lane.issues, status: 'dropped', gaps, report, attempts: attempt }
    }
    const check = report
      ? await call(checkPrompt(lane, tree, tests, contract, report), opts('integrator', `${lane.id} check`, phaseTitle, VERIFY))
      : null
    let gaps = laneGaps(lane, wave, report, check)
    if (gaps.length === 0 && lane.risk === 'high') {
      const review = await call(
        `Review lane ${lane.id} before it merges. Worktree ${tree}, read only. Brief: ${plan.brief}. Diff: git diff ${plan.branch}...lane-${lane.id}.\nDone when:\n${list(lane.doneWhen)}`,
        opts('reviewer', `${lane.id} review`, phaseTitle, FINDINGS),
      )
      gaps = (review ? review.findings : [])
        .filter(f => f.severity === 'must' || f.security === true)
        .map(describe)
    }
    if (gaps.length === 0) {
      return { id: lane.id, issues: lane.issues, status: 'ready', report, outside: check.outsideFiles || [], attempts: attempt }
    }
    if (attempt > LIMITS.laneRetries) {
      log(`Lane ${lane.id} dropped after ${attempt} attempts: ${gaps[0]}`)
      return { id: lane.id, issues: lane.issues, status: 'dropped', gaps, report, attempts: attempt }
    }
    report = await call(
      `${task}\n\nYour last attempt left these gaps. Close each one, then report again:\n${list(gaps)}`,
      opts('implementer', `${lane.id} fix ${attempt}`, phaseTitle, laneSchema(lane)),
    )
  }
}

async function merge(label, lanes, phaseTitle) {
  if (lanes.length === 0) return null
  const tree = `${plan.repo}/.claude/worktrees/check-${slug(label)}`
  const answer = await call(
    [
      `Merge ${label} into ${plan.branch}. ${WHERE}`,
      `In this order, one merge commit each: git merge --no-ff lane-<id> -m "Merge <issues>: <summary>" plus the brief's trailers. A lane already merged (a resumed run) counts as merged.\n${list(
        lanes.map(lane => `${lane.id}: branch lane-${lane.id}, ${lane.issues.join(', ')}`),
      )}`,
      CHECKS.fast.length
        ? `Then run the fast checks in a clean worktree of the merged head, so the lane worktrees inside the repo stay out of them: git -C ${plan.repo} worktree add --detach ${tree} HEAD, copy in the local config the brief lists, run ${CHECKS.fast.join(' · ')} there, then remove it. Fix only what the merge broke, in the main checkout as its own commit; report anything else as a failed check.`
        : '',
      "Push the branch. Remove each merged lane's worktree (git worktree remove); keep its branch. Report each lane by the id before its colon.",
    ]
      .filter(Boolean)
      .join('\n\n'),
    opts('integrator', `${label} merge`, phaseTitle, MERGE),
  )
  if (!answer) {
    log(`${label}: the merge agent returned nothing, so nothing from it counts as merged.`)
    return null
  }
  // Merge agents name lanes by id or by branch (lane-<id>); both count.
  const ids = new Set(lanes.map(lane => lane.id))
  const toId = name => {
    const text = String(name).trim()
    return ids.has(text) ? text : text.replace(/^lane-/, '')
  }
  const merged = {
    ...answer,
    merged: answer.merged.map(toId).filter(id => ids.has(id)),
    failed: answer.failed.map(failure => ({ ...failure, id: toId(failure.id) })),
  }
  if (merged.failed.length) log(`${label}: ${merged.failed.length} merges failed (${merged.failed.map(f => f.id).join(', ')}).`)
  return merged
}

// Reviews and audits work in a throwaway worktree on the head: the main checkout holds the lanes' worktrees.
const throwaway = name =>
  `Create a throwaway worktree: git -C ${plan.repo} worktree add --detach ${plan.repo}/.claude/worktrees/${name} ${plan.branch}; work there and remove it when done.`

async function review(label, diff, scope, extra, withUi, phaseTitle) {
  const tasks = [
    () =>
      call(
        [
          `Review ${label}, read only. ${throwaway(`review-${slug(label)}`)} Brief: ${plan.brief}. Diff: git diff ${diff}.`,
          `Issues and Done-when:\n${scope}`,
          extra,
        ]
          .filter(Boolean)
          .join('\n'),
        opts('reviewer', `${label} review`, phaseTitle, FINDINGS),
      ),
  ]
  if (withUi && plan.ui) {
    const ui = plan.ui
    const reference = ui.reference
      ? `Design reference: ${ui.reference}.${ui.standard ? ` House standard: ${ui.standard}.` : ''}`
      : 'No design reference: the Done-when items about the screen are the reference. At every size, all of it is visible, nothing is cut off or overlapping, and the layout is what the items say.'
    for (const area of ui.areas || []) {
      tasks.push(() =>
        call(
          [
            `Audit ${area.name} for ${label}. ${throwaway(`audit-${slug(label)}-${slug(area.name)}`)}`,
            `DB ${area.db || 'none'}, port ${area.port || 'none'}. Brief: ${plan.brief}.`,
            `${reference} Sizes and locales: ${ui.sizes || 'desktop (1280×720) and phone (390×844)'}.`,
            `Issues and Done-when:\n${scope}`,
            extra,
          ]
            .filter(Boolean)
            .join('\n'),
          opts('auditor', `${label} audit ${area.name}`, phaseTitle, FINDINGS),
        ),
      )
    }
  }
  return (await parallel(tasks)).filter(Boolean).flatMap(result => result.findings || [])
}

// Findings become fix lanes grouped by file (at most MAX_FIX_LANES), built and
// re-checked like any lane, then merged. Whatever doesn't merge stays open.
async function fix(label, findings, phaseTitle) {
  const todo = findings.filter(actionable)
  if (todo.length === 0) return { merged: [], open: [], head: '' }
  const byFile = new Map()
  for (const finding of todo) byFile.set(finding.file, [...(byFile.get(finding.file) || []), finding])
  const files = [...byFile.keys()]
  const count = Math.min(MAX_FIX_LANES, files.length)
  if (files.length > count) log(`${label}: findings in ${files.length} files grouped into ${count} fix lanes.`)
  const fixLanes = Array.from({ length: count }, (_, i) => {
    const mine = files.filter((_, j) => j % count === i)
    const items = mine.flatMap(file => byFile.get(file))
    return {
      id: `${slug(label)}-fix${i + 1}`,
      issues: [`${label} findings`],
      doneWhen: items.map(describe),
      owns: [...new Set(items.flatMap(item => item.files || [item.file]))],
      findings: items,
    }
  })
  const fixWave = { lanes: fixLanes }
  const results = await parallel(fixLanes.map(lane => () => runLane(lane, fixWave, NO_CONTRACT, phaseTitle)))
  const merged = await merge(`${label} fixes`, results.filter(result => result && result.status === 'ready'), phaseTitle)
  const mergedIds = new Set(merged ? merged.merged : [])
  unmergedFixes.push(...fixLanes.filter(lane => !mergedIds.has(lane.id)).map(lane => lane.id))
  const open = fixLanes.filter(lane => !mergedIds.has(lane.id)).flatMap(lane => lane.findings)
  if (open.length) log(`${label}: ${open.length} findings left open.`)
  return { merged: [...mergedIds], open, head: merged ? merged.head : '' }
}

// What the gates can't settle, handed to the wave's reviewers: untested Done-when
// items, the lanes' own notes, and files they changed outside what they own.
function handOff(results, contract) {
  const notes = results.flatMap(result => {
    const issues = result.issues.join(', ')
    const outside = result.outside || []
    return [
      ...untestableOf(contract, result.id).map(item => `${issues}: no automated test proves this, so check it by hand: ${item}`),
      ...((result.report && result.report.open) || []).map(item => `${issues}: the lane left a note: ${item}`),
      ...(outside.length ? [`${issues}: changed files outside its own: ${outside.join(', ')}; check each change is needed`] : []),
    ]
  })
  return notes.length ? `Check these too:\n${list(notes)}` : ''
}

const gatePrompt = label =>
  [
    `Run the final gate on ${plan.branch} at its head. Brief: ${plan.brief}. Change nothing; run long suites in the background.`,
    `Work in a clean worktree of the head, so the lane worktrees inside the repo stay out of the suites: git -C ${plan.repo} worktree add --detach ${plan.repo}/.claude/worktrees/check-${slug(label)} ${plan.branch}, copy in the local config the brief lists, and remove it when done.`,
    `Report each with exact counts:\n${list(FULL)}`,
    'For each failure: the failing tests, the likely cause and the files involved. A flaky failure counts as a failure; say if it fails near midnight UTC.',
  ].join('\n')

const isGreen = gate => Boolean(gate) && gate.checks.length > 0 && gate.checks.every(c => c.pass)

const lanes = []
const reviews = []
const open = []
const questions = []
const unmergedFixes = []
const untestable = []
let head = plan.base
let stopped = ''

for (let i = 0; i < plan.waves.length; i++) {
  const wave = plan.waves[i]
  const w = i + 1
  if (budgetLow()) {
    stopped = `token budget nearly spent before wave ${w}`
    log(`Stopped: ${stopped}.`)
    break
  }

  phase('Contract')
  const contract = await writeContract(wave, w)

  phase('Build')
  const results = (await parallel(wave.lanes.map(lane => () => runLane(lane, wave, contract)))).map(
    (result, k) => result || { id: wave.lanes[k].id, issues: wave.lanes[k].issues, status: 'dropped', gaps: ['the lane crashed'] },
  )
  for (const result of results) {
    if (result.status === 'questions') questions.push(...result.questions.map(q => `${result.id}: ${q}`))
  }

  phase('Merge')
  const merged = await merge(`wave ${w}`, results.filter(result => result.status === 'ready'), 'Merge')
  const mergedIds = new Set(merged ? merged.merged : [])
  for (const result of results) lanes.push({ ...result, merged: mergedIds.has(result.id), wave: w })
  const before = head
  if (merged && merged.head) head = merged.head
  const landed = results.filter(result => mergedIds.has(result.id))
  for (const result of landed) untestable.push(...untestableOf(contract, result.id).map(item => `${result.issues.join(', ')}: ${item}`))

  const shippedCode = wave.lanes.filter(lane => isCode(lane) && mergedIds.has(lane.id))
  if (shippedCode.length === 0) continue
  phase('Review')
  const scope = list(shippedCode.map(lane => `${lane.issues.join(', ')}: ${lane.doneWhen.join('; ')}`))
  const findings = await review(`wave ${w}`, `${before}..${head}`, scope, handOff(landed, contract), shippedCode.some(lane => lane.ui), 'Review')
  const fixed = await fix(`wave ${w} review`, findings, 'Review')
  if (fixed.head) head = fixed.head
  open.push(...fixed.open)
  reviews.push({ round: `wave ${w}`, findings: findings.length, actionable: findings.filter(actionable).length, open: fixed.open.length })
}

phase('Final gate')
let gate = null
if (FULL.length === 0) log('The plan lists no checks, so there is no final gate.')
for (let round = 1; FULL.length > 0 && !stopped; round++) {
  gate = await call(gatePrompt(`gate ${round}`), opts('integrator', `gate ${round}`, 'Final gate', GATE))
  if (gate && gate.head) head = gate.head
  if (!gate || isGreen(gate)) break
  if (round > LIMITS.gateRounds) {
    log(`The final gate is still red after ${round} rounds.`)
    break
  }
  const failures = gate.failures.map(f => ({
    severity: 'must',
    file: f.files[0] || 'the failing tests',
    files: f.files,
    problem: f.problem,
    fix: 'root-cause and fix it; prove a flaky fix with about 10 repeats',
  }))
  const fixed = await fix(`gate ${round}`, failures, 'Final gate')
  if (fixed.head) head = fixed.head
  if (fixed.merged.length === 0) {
    open.push(...fixed.open)
    log('Final gate: no fix merged, so the gate stops here.')
    break
  }
}

if (isGreen(gate)) {
  const shipped = plan.waves.flatMap(wave => wave.lanes).filter(lane => lanes.some(done => done.id === lane.id && done.merged))
  const scope = list(shipped.map(lane => `${lane.issues.join(', ')}: ${lane.doneWhen.join('; ')}`))
  const extra = [
    'Also: check every Done-when item against code and tests; check cross-lane interactions on shared flows; re-run claimed results where cheap.',
    plan.ui ? 'Re-verify every earlier UI finding as fixed, partly or not, with evidence.' : '',
    untestable.length ? `No automated test proves these, so check each by hand:\n${list(untestable)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const findings = await review('the whole diff', `${plan.base}..${head}`, scope, extra, Boolean(plan.ui), 'Final gate')
  const fixed = await fix('final review', findings, 'Final gate')
  if (fixed.head) head = fixed.head
  open.push(...fixed.open)
  reviews.push({ round: 'final', findings: findings.length, actionable: findings.filter(actionable).length, open: fixed.open.length })
  if (fixed.merged.length) {
    gate = await call(gatePrompt('gate after final fixes'), opts('integrator', 'gate after final fixes', 'Final gate', GATE))
    if (gate && gate.head) head = gate.head
  }
}

const planned = plan.waves.flatMap(wave => wave.lanes)
const shippedIds = new Set(lanes.filter(lane => lane.merged).map(lane => lane.id))
const notShipped = planned
  .filter(lane => !shippedIds.has(lane.id))
  .map(lane => {
    const done = lanes.find(result => result.id === lane.id)
    const why = !done
      ? stopped || 'not started'
      : done.status === 'questions'
        ? 'waiting on the user'
        : done.status === 'ready'
          ? 'the merge failed'
          : (done.gaps || ['dropped'])[0]
    return { id: lane.id, issues: lane.issues, why }
  })
const green = isGreen(gate)
const blockingOpen = open.filter(f => f.severity === 'must' || f.security === true)
const outcome =
  shippedIds.size === 0
    ? 'BLOCKED'
    : notShipped.length === 0 && green && blockingOpen.length === 0 && !stopped
      ? 'DONE'
      : 'PARTIAL'

return {
  outcome,
  head,
  shipped: planned.filter(lane => shippedIds.has(lane.id)).map(lane => ({ id: lane.id, issues: lane.issues })),
  notShipped,
  lanes: lanes.map(lane => ({
    id: lane.id,
    status: lane.status,
    merged: lane.merged,
    attempts: lane.attempts || 0,
    decisions: lane.report ? lane.report.decisions || [] : [],
    notes: lane.report ? lane.report.open || [] : [],
    outside: lane.outside || [],
  })),
  // Done-when items of shipped lanes that no automated test proves: for the PR's manual checks.
  untestable,
  reviews,
  gate: gate ? { green, checks: gate.checks } : { green: false, checks: [], note: FULL.length ? 'the gate did not run' : 'the plan lists no checks' },
  open: open.map(describe),
  security: open.filter(f => f.security === true).map(describe),
  questions,
  stopped,
  // Worktrees of lanes that never merged, for the main session to remove.
  leftover: [...lanes.filter(lane => !lane.merged).map(lane => lane.id), ...unmergedFixes].map(
    id => `${plan.repo}/.claude/worktrees/lane-${id}`,
  ),
}
