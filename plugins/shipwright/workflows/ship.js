export const meta = {
  name: 'ship',
  description: 'Ship a planned goal on one branch: contract tests, lanes in waves, re-checked claims, merges, reviews and a final gate',
  whenToUse: 'Started by /shipwright:run with the plan it writes; not for direct use',
  phases: [
    { title: 'Contract', detail: 'failing acceptance tests from the Done-when items, before any code' },
    { title: 'Build', detail: 'one implementer per lane in its own worktree; every claim re-run' },
    { title: 'Merge', detail: 'ready lanes into the feature branch, fast checks, push' },
    { title: 'Review', detail: 'one reviewer per wave; must and security findings get fix lanes' },
    { title: 'Final gate', detail: 'full suites, whole-diff review and UI audits, last fixes' },
  ],
}

// The run's control flow lives here, in code: what runs in what order, how
// often a lane may retry, and when the run stops. Agents do the work and
// report schema-checked JSON; every gate below is plain code over it.

const TYPE = {
  implementer: 'shipwright:implementer',
  reviewer: 'shipwright:reviewer',
  auditor: 'shipwright:ui-auditor',
  integrator: 'shipwright:integrator',
}
const MAX_FIX_LANES = 4
const RESERVE = 50_000
// A commit hash and nothing else: these values go straight into git commands and ranges.
const SHA = '^[0-9a-f]{7,40}$'
const SHA_OR_EMPTY = '^([0-9a-f]{7,40})?$'
// A full object id as git rev-parse prints it, or empty: the contract guard compares these in code.
const OBJECT_OR_EMPTY = '^([0-9a-f]{40,64})?$'
const DOCS = /\.(md|mdx|rst|txt)$/i

const CHECK = {
  type: 'object',
  required: ['cmd', 'pass', 'counts'],
  properties: {
    cmd: { type: 'string' },
    pass: { type: 'boolean' },
    counts: { type: 'string' },
    foreign: {
      type: 'boolean',
      description: 'with pass false: true only when every failing test is in a file outside the lane, and the same tests fail the same way on the feature branch without the lane',
    },
  },
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
    needs: {
      type: 'array',
      items: { type: 'string' },
      description: "with blocked: the ids of lanes building alongside you whose work you can't finish without",
    },
    questions: { type: 'array', items: { type: 'string' }, description: 'around mode only: what only the user can decide' },
  },
}
// Exactly one Done-when entry per item: a short or split report fails at the tool call, not after a whole re-check and retry.
const laneSchema = lane => ({
  ...LANE,
  properties: {
    ...LANE.properties,
    doneWhen: { ...LANE.properties.doneWhen, minItems: lane.doneWhen.length, maxItems: lane.doneWhen.length },
  },
})
const VERIFY = {
  type: 'object',
  required: ['checks', 'contract', 'clean', 'outsideFiles'],
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['cmd', 'pass', 'counts', 'matchesReport'],
        properties: { ...CHECK.properties, matchesReport: { type: 'boolean' } },
      },
    },
    contract: {
      type: 'array',
      description: 'one entry per contract test file, in the order given',
      items: {
        type: 'object',
        required: ['file', 'atContract', 'atHead'],
        properties: {
          file: { type: 'string' },
          atContract: { type: 'string', pattern: OBJECT_OR_EMPTY, description: 'what git rev-parse <contract sha>:<file> prints; empty if there is no such file' },
          atHead: { type: 'string', pattern: OBJECT_OR_EMPTY, description: 'what git rev-parse HEAD:<file> prints; empty if there is no such file' },
        },
      },
    },
    clean: { type: 'boolean' },
    outsideFiles: { type: 'array', items: { type: 'string' } },
  },
}
// One contract entry per file, so a re-check can't skip the guard.
const verifySchema = files => ({
  ...VERIFY,
  properties: { ...VERIFY.properties, contract: { ...VERIFY.properties.contract, minItems: files.length, maxItems: files.length } },
})
// One entry per lane, under its lane id: a writer can't file a lane's tests under an issue key,
// and an untestable entry must be one of that lane's Done-when items.
const contractSchema = lanes => ({
  type: 'object',
  required: ['sha', 'lanes'],
  properties: {
    sha: { type: 'string', pattern: SHA_OR_EMPTY, description: 'the commit that adds the contract tests (empty if no item can be tested)' },
    lanes: {
      type: 'object',
      description: 'one entry per lane, under its lane id',
      required: lanes.map(lane => lane.id),
      additionalProperties: false,
      properties: Object.fromEntries(
        lanes.map(lane => [
          lane.id,
          {
            type: 'object',
            required: ['files', 'untestable'],
            properties: {
              files: { type: 'array', items: { type: 'string' } },
              untestable: {
                type: 'array',
                description: 'the Done-when items no automated test can prove, each with why; nothing else',
                items: {
                  type: 'object',
                  required: ['item', 'why'],
                  properties: {
                    item: lane.doneWhen.length ? { type: 'string', enum: [...new Set(lane.doneWhen)] } : { type: 'string' },
                    why: { type: 'string' },
                  },
                },
              },
              notes: { type: 'array', items: { type: 'string' }, description: 'anything else the lane should know, such as the API the tests expect' },
            },
          },
        ]),
      ),
    },
  },
})
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
          files: { type: 'array', items: { type: 'string' }, description: 'every file the fix must change, file included, when it is more than one' },
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
    // The run skill fixes the plan and relaunches on `error`.
    error: 'the plan needs repo, branch, base, brief and at least one wave',
    summary: 'The ship workflow runs the plan /shipwright:run writes (repo, branch, base, brief, waves); start it from there.',
  }
}
const LIMITS = { laneRetries: 2, gateRounds: 2, ...(plan.limits || {}) }
const CHECKS = { fast: [], full: [], ...(plan.checks || {}) }
const FULL = CHECKS.full.length ? CHECKS.full : CHECKS.fast
const WHERE = `Main checkout ${plan.repo}, feature branch ${plan.branch}. Brief: ${plan.brief}. Mode: ${plan.mode || 'away'}.`
const NO_CONTRACT = { sha: '', lanes: [] }
const REPO = `${plan.repo.replace(/\\/g, '/').replace(/\/+$/, '')}/`

const list = items => items.map(item => `- ${item}`).join('\n')
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const isCode = lane => (lane.kind || 'code') === 'code'
const actionable = finding => finding.severity !== 'nit' || finding.security === true
const blocking = finding => finding.severity === 'must' || finding.security === true
const describe = f =>
  `${f.severity}${f.security ? ' (security)' : ''} ${f.file}${f.line ? `:${f.line}` : ''} — ${f.problem} — fix: ${f.fix}`
const budgetLow = () => typeof budget !== 'undefined' && budget.total && budget.remaining() < RESERVE
const untestableOf = (contract, id) => ((contract.lanes || []).find(entry => entry.id === id) || {}).untestable || []
const crashed = lane => ({ id: lane.id, issues: lane.issues, status: 'dropped', gaps: ['the lane crashed'] })
// Paths compare repo-relative, with forward slashes; agents sometimes give absolute ones.
const normal = path => {
  const relative = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  return relative.toLowerCase().startsWith(REPO.toLowerCase()) ? relative.slice(REPO.length) : relative
}
// owns lists files or directories; a file's own tests count as the file's.
const ownsFile = (lane, file) => {
  const path = normal(file)
  return lane.owns.map(normal).some(entry => path === entry || path.startsWith(`${entry}/`) || unitOf(path) === unitOf(entry))
}
// A source file and its tests are one unit: a fix to one often needs the other.
const unitOf = file => normal(file).replace(/\.(contract\.)?(test|spec)(?=\.[^./]+$)/, '')
const filesOf = finding => ((finding.files || []).length ? finding.files : [finding.file])
// One review round for the result: counts, plus the text of the nits, which get no fix lane.
const summary = (round, findings, fixed) => ({
  round,
  findings: findings.length,
  actionable: findings.filter(actionable).length,
  open: fixed.open.length,
  nits: findings.filter(finding => !actionable(finding)).map(describe),
})

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

// A lane's own model and effort (chosen per lane under --auto) override the run's for its implementer.
function opts(role, label, phaseTitle, schema, lane) {
  const models = plan.models || {}
  const choice = models[role] || (role === 'auditor' ? models.reviewer : undefined) || {}
  const own = role === 'implementer' && lane ? lane : {}
  const options = { agentType: TYPE[role], label, phase: phaseTitle, schema }
  const model = own.model || choice.model
  const effort = own.effort || choice.effort
  if (model) options.model = model
  if (effort) options.effort = effort
  return options
}

// Earlier lanes that didn't ship: what later lanes and reviews must not wait for.
const notLanded = () =>
  planned.filter(lane => lanes.some(done => done.id === lane.id) && !lanes.some(done => done.id === lane.id && done.merged))
const notLandedText = () =>
  notLanded()
    .map(lane => `${lane.id} (${lane.issues.join(', ')})`)
    .join(', ')

async function writeContract(wave, w) {
  const lanes = plan.contract === false ? [] : wave.lanes.filter(isCode)
  if (lanes.length === 0) return NO_CONTRACT
  const branch = `contract-wave-${w}`
  const tree = `${plan.repo}/.claude/worktrees/${branch}`
  const unshipped = notLandedText()
  const contract = await call(
    [
      `Write the acceptance contract for wave ${w}. ${WHERE}`,
      `Work in a throwaway worktree: git -C ${plan.repo} worktree add -b ${branch} ${tree} ${plan.branch} (if branch ${branch} already exists from an earlier attempt, add the worktree on it and check what it holds). For each Done-when item below that an automated test can prove, write a failing acceptance test in the repo's test layout, in new files of each lane's own, named so the lane's own test files stay free (for example <module>.contract.test.ts) and so the lane's e2e filter, where it has one, matches its e2e files. Write them as ordinary tests: import what the lane will create the way the code will use it, with no dynamic imports, type copies or any-casts to get around the missing code. Import only the lane's own files and code already on the branch, and build by hand any state another lane's code would make, so no lane waits for another. Scope every UI query to the lane's own part of the screen and its own test data: later lanes add controls and rows, so never assert a page-wide count or that an element is the only one of its role. Run them and confirm each fails only because the feature is missing: a missing module or export counts; a syntax, type or config error in the tests themselves doesn't. If the branch has no test runner installed yet (this wave creates the toolchain), don't install or fetch one to run them: say so in notes. Write no feature code and change no config. List every item you can't test as untestable, with why, and put anything else the lane should know (the API the tests expect, the setup they need) in notes.`,
      unshipped ? `These earlier lanes didn't ship: ${unshipped}. Write no test for an item that needs their work; list it as untestable with why "needs <lane id>".` : '',
      `Commit the tests on ${branch} as one commit in the brief's format ("Add acceptance tests for wave ${w}"). Don't push. Remove the worktree and keep the branch: each lane brings in only its own tests, so a lane that doesn't ship leaves no failing tests behind.`,
      `Report each lane under its lane id (the word after "Lane"), not its issue keys.`,
      ...lanes.map(lane => `Lane ${lane.id} (${lane.issues.join(', ')}), will own ${lane.owns.join(', ')}${lane.e2e ? `, e2e filter ${lane.e2e}` : ''}:\n${list(lane.doneWhen)}`),
    ]
      .filter(Boolean)
      .join('\n\n'),
    opts('implementer', `wave ${w} contract`, 'Contract', contractSchema(lanes)),
  )
  if (!contract) {
    log(`Wave ${w}: the contract could not be written; its lanes run without one.`)
    return NO_CONTRACT
  }
  // Back to a list of entries by lane id, the shape the rest of the run reads.
  const entries = contract.lanes || {}
  const missing = lanes.filter(lane => !entries[lane.id]).map(lane => lane.id)
  if (missing.length) log(`Wave ${w}: the contract has no entry for ${missing.join(', ')}; those lanes run without contract tests.`)
  return {
    sha: contract.sha,
    lanes: lanes
      .filter(lane => entries[lane.id])
      .map(lane => ({
        id: lane.id,
        files: entries[lane.id].files || [],
        untestable: (entries[lane.id].untestable || []).map(entry => `${entry.item} (${entry.why})`),
        notes: entries[lane.id].notes || [],
      })),
  }
}

function checkPrompt(lane, tree, files, contract, report) {
  return [
    `Re-check lane ${lane.id} in ${tree} (branch lane-${lane.id}). Brief: ${plan.brief}. Change nothing there: no edits, copied files, stashes or checkouts.`,
    `Re-run each check the lane reported; matchesReport says whether your counts match:\n${list(
      (report.checks || []).map(c => `${c.cmd} → ${c.pass ? 'pass' : 'fail'}, ${c.counts}`),
    )}`,
    `A check that fails only in tests outside ${[...lane.owns, ...files].join(', ')}: run those tests on ${plan.branch} in a throwaway worktree (git -C ${plan.repo} worktree add --detach ${plan.repo}/.claude/worktrees/base-${lane.id} ${plan.branch}, removed afterwards). If they fail the same way there, mark the check foreign: true; it then goes to the final gate, not against this lane.`,
    files.length
      ? `contract: for each file below, what git rev-parse ${contract.sha}:<file> and git rev-parse HEAD:<file> print:\n${list(files)}`
      : 'contract: [] (this lane has no contract tests).',
    `clean: git status --porcelain | wc -l prints 0. outsideFiles: files in git diff --name-only ${plan.branch}...HEAD outside ${[...lane.owns, ...files].join(', ')}.`,
  ].join('\n')
}

// Unmet Done-when items the lane may leave: one that needs an earlier lane that didn't ship,
// and, in a fix lane, a finding it judged not fixable there. Their indexes, in the lane's order.
function waived(lane, report) {
  const missing = notLanded().map(other => other.id)
  return (report.doneWhen || []).flatMap((item, k) => {
    if (item.met) return []
    const proof = String(item.proof || '').trim()
    const needs = /^needs\s+(\S+)/i.exec(proof)
    if (needs && missing.includes(needs[1].replace(/[.,;:]$/, ''))) return [k]
    return lane.findings && /^won'?t fix:/i.test(proof) ? [k] : []
  })
}

// A failing check counts against the lane unless it fails outside the lane and on the branch too.
const failing = c => !c.pass && c.foreign !== true

// Plain code over the lane's own report. A gap here sends the lane back without a re-check.
function reportGaps(lane, report) {
  if (!report) return ['the implementer returned no report']
  const gaps = []
  const items = report.doneWhen || []
  if (items.length !== lane.doneWhen.length) gaps.push(`the report has ${items.length} entries for ${lane.doneWhen.length} Done-when items`)
  const excused = new Set(waived(lane, report))
  items.forEach((item, k) => {
    if (!item.met && !excused.has(k)) gaps.push(`Done-when not met: ${item.item}`)
  })
  if (isCode(lane) && !(report.checks || []).length) gaps.push('the lane reported no checks')
  for (const c of report.checks || []) if (failing(c)) gaps.push(`check failing: ${c.cmd} (${c.counts})`)
  if (gaps.length === 0 && report.status !== 'done') {
    gaps.push(...((report.open || []).length ? report.open : ['the lane reported itself unfinished']))
  }
  return gaps
}

// Plain code over the re-check: what still stands between the lane and a merge.
function checkGaps(lane, wave, files, report, check) {
  if (!check) return ['the claims could not be re-checked']
  const gaps = []
  const reran = check.checks || []
  const claimed = report.checks || []
  if (reran.length < claimed.length) gaps.push(`only ${reran.length} of the ${claimed.length} reported checks could be re-run`)
  for (const c of reran) {
    if (failing(c)) gaps.push(`re-run failed: ${c.cmd} (${c.counts})`)
    else if (!c.pass) continue
    else if (!c.matchesReport) gaps.push(`re-run counts differ from the report: ${c.cmd} (${c.counts})`)
  }
  const edited = contractEdits(files, check)
  if (edited.length) gaps.push(`contract tests were edited or left out: ${edited.join(', ')}; bring them back unchanged and make the code pass them`)
  if (!check.clean) gaps.push('the worktree has uncommitted changes')
  const ownTests = new Set(files.map(normal))
  for (const file of check.outsideFiles || []) {
    const owner = !ownTests.has(normal(file)) && wave.lanes.find(other => other.id !== lane.id && ownsFile(other, file))
    if (owner) gaps.push(`edited ${file}, which lane ${owner.id} owns`)
  }
  return gaps
}

// The contract guard runs here, in code. The re-check reports each contract file's
// object id at the contract commit and at the lane head; any difference is an edit.
function contractEdits(files, check) {
  const reported = new Map((check.contract || []).map(entry => [normal(entry.file), entry]))
  return files.filter(file => {
    const entry = reported.get(normal(file))
    return !entry || entry.atHead !== entry.atContract
  })
}

// after: lanes of the same round that merged while this one waited for them.
async function runLane(lane, wave, contract, phaseTitle = 'Build', after = []) {
  const tree = `${plan.repo}/.claude/worktrees/lane-${lane.id}`
  const tests = (contract.lanes || []).find(entry => entry.id === lane.id)
  const files = tests ? tests.files : []
  const others = wave.lanes.filter(other => other.id !== lane.id)
  const task = [
    `Lane ${lane.id}: ${lane.issues.join(', ')}. ${WHERE}`,
    `Worktree ${tree}, branch lane-${lane.id}. If it doesn't exist yet, create it: git -C ${plan.repo} worktree add -b lane-${lane.id} ${tree} ${plan.branch} (or, if branch lane-${lane.id} already exists, git -C ${plan.repo} worktree add ${tree} lane-${lane.id}).`,
    after.length
      ? `Since you started, ${after.join(', ')} merged into ${plan.branch}: first bring that in with git merge ${plan.branch}, its message in the brief's format.`
      : '',
    `Done when:\n${list(lane.doneWhen)}`,
    (lane.owns.length ? `Own: ${lane.owns.join(', ')}, with their tests.` : 'Own: only the files this fix needs.') +
      (lane.avoid && lane.avoid.length ? ` Don't touch: ${lane.avoid.join(', ')}.` : ''),
    others.length
      ? `Building alongside you: ${others.map(other => (other.owns.length ? `${other.id} (${other.owns.join(', ')})` : other.id)).join('; ')}. If you can't finish without one of them, report blocked with its id in needs.`
      : '',
    lane.db || lane.port ? `DB ${lane.db || 'none'}, port ${lane.port || 'none'}.` : '',
    lane.e2e ? `e2e filter: ${lane.e2e}` : '',
    isCode(lane) && CHECKS.fast.length ? `Report at least these checks: ${CHECKS.fast.join(' · ')}.` : '',
    files.length
      ? `Contract tests: unless your branch already has them, first bring in your own with git checkout ${contract.sha} -- ${files.join(' ')} and commit them in the brief's format ("Add acceptance tests for ${lane.issues.join(', ')}"). Make them pass and never edit them.`
      : '',
    tests && (tests.notes || []).length ? `From the contract's writer:\n${list(tests.notes)}` : '',
    lane.answers && lane.answers.length ? `The user's answers:\n${list(lane.answers)}` : '',
    notLanded().length
      ? `These earlier lanes didn't ship: ${notLandedText()}. Report a Done-when item that can't be met without one of them as met: false, with proof starting "needs <lane id>"; meet the rest.`
      : '',
    lane.findings
      ? 'A finding you judge wrong, or not fixable within these files, may stay: report it met: false with proof starting "won\'t fix:" and why. Fix the rest.'
      : '',
    `A check that fails only in tests outside your files, which fail the same way on ${plan.branch} without your change: report it pass: false, foreign: true.`,
  ]
    .filter(Boolean)
    .join('\n')

  let report = await call(task, opts('implementer', `${lane.id} ${after.length ? 'build again' : 'build'}`, phaseTitle, laneSchema(lane), lane))
  for (let attempt = 1; ; attempt++) {
    if (plan.mode === 'around' && report && (report.questions || []).length) {
      return { id: lane.id, issues: lane.issues, status: 'questions', questions: report.questions, attempts: attempt }
    }
    // Blocked means outside the lane's reach (a secret, a service): a retry can't fix it.
    // Waiting for a lane building alongside is different: it runs again once that one merges.
    if (report && report.status === 'blocked') {
      const needs = (report.needs || []).filter(id => others.some(other => other.id === id))
      if (needs.length && !after.length) {
        log(`Lane ${lane.id} waits for ${needs.join(', ')}.`)
        return { id: lane.id, issues: lane.issues, status: 'waiting', needs, report, attempts: attempt }
      }
      const gaps = (report.open || []).length ? report.open : ['the lane reported itself blocked']
      log(`Lane ${lane.id} blocked: ${gaps[0]}`)
      return { id: lane.id, issues: lane.issues, status: 'dropped', gaps, report, attempts: attempt }
    }
    let gaps = reportGaps(lane, report)
    // Every item left on purpose: nothing to merge, and a retry would only push the lane to do what it judged it can't.
    const left = report ? waived(lane, report) : []
    if (gaps.length === 0 && left.length === lane.doneWhen.length) {
      log(`Lane ${lane.id} left every Done-when item: ${report.doneWhen[0].proof}`)
      return { id: lane.id, issues: lane.issues, status: 'dropped', gaps: left.map(k => `${lane.doneWhen[k]} (${report.doneWhen[k].proof})`), report, attempts: attempt }
    }
    let check = null
    if (gaps.length === 0) {
      const recheck = again =>
        call(checkPrompt(lane, tree, files, contract, report), opts('integrator', `${lane.id} check${again ? ' again' : ''}`, phaseTitle, verifySchema(files)))
      check = await recheck(false)
      // A re-check that died says nothing about the lane: ask again rather than rebuild it.
      if (check === null && !stopped) check = await recheck(true)
      if (check === null) {
        log(`Lane ${lane.id} dropped: its claims could not be re-checked.`)
        return { id: lane.id, issues: lane.issues, status: 'dropped', gaps: ['the claims could not be re-checked'], report, attempts: attempt }
      }
      gaps = checkGaps(lane, wave, files, report, check)
    }
    let premerge = []
    let reviewOnly = false
    // A lane alone in its wave gets the wave review right after it merges, which is the same review.
    if (gaps.length === 0 && lane.risk === 'high' && others.length) {
      const review = await call(
        `Review lane ${lane.id} before it merges. Worktree ${tree}, read only. Brief: ${plan.brief}. Diff: git diff ${plan.branch}...lane-${lane.id}.\nDone when:\n${list(lane.doneWhen)}`,
        opts('reviewer', `${lane.id} review`, phaseTitle, FINDINGS),
      )
      const found = review ? review.findings : []
      gaps = found.filter(blocking).map(describe)
      reviewOnly = gaps.length > 0
      premerge = reviewOnly ? found : found.filter(finding => !blocking(finding))
      if (!review) {
        // No answer is not a clean review: the wave review is told to start with this lane.
        log(`Lane ${lane.id}: its pre-merge review did not run.`)
        premerge = [{ severity: 'should', file: `lane-${lane.id}`, problem: 'its high-risk pre-merge review did not run', fix: 'review this lane first, as a pre-merge review would' }]
      }
    }
    const ready = () => {
      const outside = (check.outsideFiles || []).filter(file => !ownsFile(lane, file))
      const foreign = (check.checks || []).filter(c => !c.pass && c.foreign === true).map(c => `${lane.id}: ${c.cmd} (${c.counts})`)
      return { id: lane.id, issues: lane.issues, status: 'ready', report, outside, premerge, foreign, waived: waived(lane, report), attempts: attempt }
    }
    if (gaps.length === 0) return ready()
    if (attempt > LIMITS.laneRetries) {
      // Checks green and Done-when met, so only its review's findings hold it: it merges, and they go to the wave's fix lanes.
      if (reviewOnly) {
        log(`Lane ${lane.id} merges with ${gaps.length} pre-merge findings for the wave's fix lanes.`)
        return ready()
      }
      log(`Lane ${lane.id} dropped after ${attempt} attempts: ${gaps[0]}`)
      return { id: lane.id, issues: lane.issues, status: 'dropped', gaps, report, attempts: attempt }
    }
    report = await call(
      `${task}\n\nYour last attempt left these gaps. Close each one, then report again:\n${list(gaps)}`,
      opts('implementer', `${lane.id} fix ${attempt}`, phaseTitle, laneSchema(lane), lane),
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
      `${plan.push === false ? "Don't push: the branch stays local." : 'Push the branch.'} Remove each merged lane's worktree (git worktree remove); keep its branch. Report each lane by the id before its colon.`,
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

// Builds a round's lanes side by side and merges the ready ones. A lane that waited
// for another lane of the round runs once more after that one merges, then merges too.
async function buildAndMerge(label, wave, contract, buildPhase, mergePhase) {
  const results = (await parallel(wave.lanes.map(lane => () => runLane(lane, wave, contract, buildPhase)))).map(
    (result, k) => result || crashed(wave.lanes[k]),
  )
  const merged = new Set()
  let last = ''
  const land = async (name, ready) => {
    const answer = await merge(name, ready, mergePhase)
    for (const id of answer ? answer.merged : []) merged.add(id)
    if (answer && answer.head) last = answer.head
  }
  await land(label, results.filter(result => result.status === 'ready'))
  const unblocked = results.filter(result => result.status === 'waiting' && result.needs.every(id => merged.has(id)))
  if (unblocked.length) {
    const again = await parallel(
      unblocked.map(result => () => runLane(wave.lanes.find(lane => lane.id === result.id), wave, contract, buildPhase, result.needs)),
    )
    // The first attempt's decisions still describe the lane's work.
    const withEarlier = (first, second) =>
      second && second.report && first.report
        ? { ...second, report: { ...second.report, decisions: [...(first.report.decisions || []), ...(second.report.decisions || [])] } }
        : second
    unblocked.forEach((result, k) => {
      results[results.indexOf(result)] = withEarlier(result, again[k]) || crashed(result)
    })
    await land(`${label} second pass`, again.filter(result => result && result.status === 'ready'))
  }
  for (const result of results) {
    if (result.status === 'waiting') {
      Object.assign(result, { status: 'dropped', gaps: [`it waited for ${result.needs.join(', ')}, which didn't merge`] })
    }
  }
  return { results, merged, head: last }
}

// Reviews and audits work in a throwaway worktree on the head: the main checkout holds the lanes' worktrees.
const throwaway = name =>
  `Create a throwaway worktree: git -C ${plan.repo} worktree add --detach ${plan.repo}/.claude/worktrees/${name} ${plan.branch}; work there and remove it when done.`

// complete says whether every reviewer and auditor answered.
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
    // A goal with screens is audited even when the plan names no areas.
    for (const area of (ui.areas || []).length ? ui.areas : [{ name: 'screens' }]) {
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
  const results = await parallel(tasks)
  const missing = results.filter(result => !result).length
  if (missing) log(`${label}: ${missing} of ${results.length} reviews returned nothing.`)
  return { findings: results.filter(Boolean).flatMap(result => result.findings || []), complete: missing === 0 }
}

// The same finding reported again (by another round, reviewer or auditor): one per file and
// nearby line, keeping the most severe, so the result lists each open problem once.
const RANK = { must: 0, should: 1, nit: 2 }
function dedupe(findings) {
  const kept = []
  const sorted = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.security === true) - (a.security === true))
  for (const finding of sorted) {
    const same = kept.some(
      other =>
        unitOf(other.file) === unitOf(finding.file) &&
        (other.line && finding.line ? Math.abs(other.line - finding.line) <= 5 : !other.line && !finding.line),
    )
    if (!same) kept.push(finding)
  }
  return kept
}

// Findings that share a file go to the same fix lane, a source file and its tests
// counting as one, so that no fix needs a file another fix lane owns.
function groupFindings(findings) {
  const groups = []
  for (const finding of findings) {
    const keys = filesOf(finding).map(unitOf)
    const [first, ...rest] = groups.filter(group => keys.some(key => group.keys.has(key)))
    if (!first) {
      groups.push({ keys: new Set(keys), findings: [finding] })
      continue
    }
    for (const other of rest) {
      other.keys.forEach(key => first.keys.add(key))
      first.findings.push(...other.findings)
      groups.splice(groups.indexOf(other), 1)
    }
    keys.forEach(key => first.keys.add(key))
    first.findings.push(finding)
  }
  return groups
}

// Findings become fix lanes (at most MAX_FIX_LANES), built and re-checked like any
// lane, then merged. Whatever doesn't merge stays open.
async function fix(label, findings, phaseTitle) {
  const todo = findings.filter(actionable)
  if (todo.length === 0) return { merged: [], open: [], closed: [], head: '' }
  const groups = groupFindings(todo)
  const count = Math.min(MAX_FIX_LANES, groups.length)
  if (groups.length > count) log(`${label}: findings in ${groups.length} groups of files share ${count} fix lanes.`)
  const fixLanes = Array.from({ length: count }, (_, i) => {
    const items = groups.filter((_, j) => j % count === i).flatMap(group => group.findings)
    const owns = [...new Set(items.flatMap(filesOf).map(normal))]
    // Its commits name the issues of the planned lanes whose files it changes.
    const issues = [...new Set(planned.filter(lane => owns.some(file => ownsFile(lane, file))).flatMap(lane => lane.issues))]
    return {
      id: `${slug(label)}-fix${i + 1}`,
      issues: issues.length ? issues : [`${label} findings`],
      kind: owns.every(file => DOCS.test(file)) ? 'docs' : 'code',
      doneWhen: items.map(describe),
      owns,
      findings: items,
    }
  })
  const built = await buildAndMerge(`${label} fixes`, { lanes: fixLanes }, NO_CONTRACT, phaseTitle, phaseTitle)
  for (const result of built.results) lanes.push({ ...result, merged: built.merged.has(result.id), round: label })
  // A merged fix lane closes its findings, except those it reported it won't fix.
  const left = lane => {
    const result = built.results.find(one => one.id === lane.id)
    if (!built.merged.has(lane.id)) return lane.findings
    const skipped = new Set((result && result.waived) || [])
    return lane.findings.filter((_, k) => skipped.has(k))
  }
  const open = fixLanes.flatMap(left)
  if (open.length) log(`${label}: ${open.length} findings left open.`)
  return {
    merged: [...built.merged],
    open,
    closed: fixLanes.flatMap(lane => lane.findings.filter(finding => !open.includes(finding))),
    head: built.head,
  }
}

// What the gates can't settle, handed to the wave's reviewers: untested Done-when items,
// the lanes' own notes, what their pre-merge reviews let pass, and files they changed
// outside what they own.
function handOff(results, contract) {
  const notes = results.flatMap(result => {
    const issues = result.issues.join(', ')
    const outside = result.outside || []
    return [
      ...untestableOf(contract, result.id).map(item => `${issues}: no automated test proves this, so check it by hand: ${item}`),
      ...((result.report && result.report.open) || []).map(item => `${issues}: the lane left a note: ${item}`),
      ...(result.premerge || []).map(finding => `${issues}: its pre-merge review noted: ${describe(finding)}`),
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

// What would only surface mid-build, as retries: caught before any agent runs, for the run skill to fix.
function planProblems() {
  const problems = []
  const seen = new Set()
  plan.waves.forEach((wave, i) => {
    const w = i + 1
    if (!wave || !Array.isArray(wave.lanes) || wave.lanes.length === 0) return problems.push(`wave ${w} has no lanes`)
    for (const lane of wave.lanes) {
      const name = lane && lane.id ? `lane ${lane.id}` : `a lane in wave ${w}`
      if (!lane || !lane.id) problems.push(`${name} has no id`)
      else if (seen.has(lane.id)) problems.push(`lane id ${lane.id} is used twice`)
      else seen.add(lane.id)
      for (const field of ['issues', 'doneWhen', 'owns']) {
        if (!lane || !Array.isArray(lane[field]) || lane[field].length === 0) problems.push(`${name} has no ${field}`)
      }
    }
    const lanes = wave.lanes.filter(lane => lane && Array.isArray(lane.owns))
    lanes.forEach((lane, j) => {
      for (const other of lanes.slice(j + 1)) {
        const shared = lane.owns.filter(file => ownsFile(other, file)).concat(other.owns.filter(file => ownsFile(lane, file)))
        if (shared.length) problems.push(`lanes ${lane.id} and ${other.id} of wave ${w} both own ${[...new Set(shared)].join(', ')}; move one to a later wave`)
      }
    })
  })
  return problems
}
const problems = planProblems()
if (problems.length) {
  return {
    outcome: 'BLOCKED',
    error: `the plan has problems: ${problems.join('; ')}`,
    summary: 'Fix the plan and launch the ship workflow again.',
  }
}

const planned = plan.waves.flatMap(wave => wave.lanes)
// Every lane that ran, fix lanes included, with the round that made it.
const lanes = []
const reviews = []
const open = []
const closed = []
const questions = []
const untestable = []
let head = plan.base
let stopped = ''
// The final review covers a one-wave goal's diff, so that wave gets no review of its own; what it would have been told rides along.
const carried = []
// Failures lanes met outside their own files that fail on the branch too: the final gate's to settle.
const foreign = []
// Done-when items left unmet because an earlier lane didn't ship.
const blockedItems = []
const shippedNow = () => planned.filter(lane => lanes.some(done => done.id === lane.id && done.merged))
const notShippedNote = () =>
  notLanded().length ? `These lanes didn't ship, so don't report what only they would build: ${notLandedText()}.` : ''

// The next wave's contract is written while this wave is reviewed: it needs only the merged lanes.
let nextContract = null
for (let i = 0; i < plan.waves.length; i++) {
  const wave = plan.waves[i]
  const w = i + 1
  if (stopped) break
  if (budgetLow()) {
    stopped = `token budget nearly spent before wave ${w}`
    log(`Stopped: ${stopped}.`)
    break
  }

  phase('Contract')
  const contract = await (nextContract || writeContract(wave, w))
  nextContract = null

  phase('Build')
  const built = await buildAndMerge(`wave ${w}`, wave, contract, 'Build', 'Merge')
  for (const result of built.results) {
    if (result.status === 'questions') questions.push(...result.questions.map(q => `${result.id}: ${q}`))
    lanes.push({ ...result, merged: built.merged.has(result.id), round: `wave ${w}` })
  }
  const before = head
  if (built.head) head = built.head
  const landed = built.results.filter(result => built.merged.has(result.id))
  for (const result of landed) {
    untestable.push(...untestableOf(contract, result.id).map(item => `${result.issues.join(', ')}: ${item}`))
    foreign.push(...(result.foreign || []))
    const items = planned.find(lane => lane.id === result.id).doneWhen
    blockedItems.push(...(result.waived || []).map(k => `${result.issues.join(', ')}: ${items[k]} (${result.report.doneWhen[k].proof})`))
  }
  if (i + 1 < plan.waves.length && !stopped && !budgetLow()) nextContract = writeContract(plan.waves[i + 1], w + 1)

  const shippedCode = wave.lanes.filter(lane => isCode(lane) && built.merged.has(lane.id))
  if (shippedCode.length === 0) continue
  if (plan.waves.length === 1) {
    carried.push(handOff(landed, NO_CONTRACT))
    continue
  }
  // One reviewer, no UI audits: the screens are audited once, at the final gate. Only must and security
  // findings get fix lanes here; the rest wait for the whole-diff review, which judges them again.
  phase('Review')
  const scope = list(shippedCode.map(lane => `${lane.issues.join(', ')}: ${lane.doneWhen.join('; ')}`))
  const later = plan.waves.slice(i + 1).flatMap(next => next.lanes)
  const extra = [
    handOff(landed, contract),
    later.length
      ? `Later waves still build these, so don't report them as missing:\n${list(later.map(lane => `${lane.issues.join(', ')}: ${lane.doneWhen.join('; ')}`))}`
      : '',
    notShippedNote(),
  ]
    .filter(Boolean)
    .join('\n')
  const found = await review(`wave ${w}`, `${before}..${head}`, scope, extra, false, 'Review')
  // What a lane's pre-merge review still held against it when the lane merged anyway.
  const held = landed.flatMap(result => (result.premerge || []).filter(blocking))
  const fixed = await fix(`wave ${w} review`, [...found.findings.filter(blocking), ...held], 'Review')
  if (fixed.head) head = fixed.head
  const deferred = found.findings.filter(finding => actionable(finding) && !blocking(finding))
  open.push(...fixed.open, ...deferred)
  closed.push(...fixed.closed)
  reviews.push(summary(`wave ${w}`, found.findings, { open: [...fixed.open, ...deferred] }))
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
  closed.push(...fixed.closed)
  open.push(...fixed.open)
  if (fixed.merged.length === 0) {
    log('Final gate: no fix merged, so the gate stops here.')
    break
  }
}

if (isGreen(gate)) {
  const scope = list(shippedNow().map(lane => `${lane.issues.join(', ')}: ${lane.doneWhen.join('; ')}`))
  const extra = [
    'Also: check every Done-when item against code and tests; check cross-lane interactions on shared flows; re-run claimed results where cheap.',
    closed.length ? `Earlier rounds fixed these; check each fix holds:\n${list(closed.map(describe))}` : '',
    open.length ? `Earlier rounds left these open; report each one that still holds again:\n${list(open.map(describe))}` : '',
    untestable.length ? `No automated test proves these, so check each by hand:\n${list(untestable)}` : '',
    notShippedNote(),
    blockedItems.length ? `Left unmet because a lane they need didn't ship; don't report these:\n${list(blockedItems)}` : '',
    // No wave review saw what the fix lanes left: their notes and their edits outside what they own.
    handOff(lanes.filter(lane => lane.merged && !planned.some(entry => entry.id === lane.id)), NO_CONTRACT),
    ...carried,
  ]
    .filter(Boolean)
    .join('\n')
  // The only UI audit of the run: every area, on the finished screens.
  const final = await review('the whole diff', `${plan.base}..${head}`, scope, extra, Boolean(plan.ui), 'Final gate')
  const fixed = await fix('final review', final.findings, 'Final gate')
  if (fixed.head) head = fixed.head
  closed.push(...fixed.closed)
  // The whole-diff review judged every earlier open finding again, so what it leaves open replaces them.
  if (final.complete) open.length = 0
  open.push(...fixed.open)
  reviews.push(summary('final', final.findings, fixed))
  if (fixed.merged.length) {
    gate = await call(gatePrompt('gate after final fixes'), opts('integrator', 'gate after final fixes', 'Final gate', GATE))
    if (gate && gate.head) head = gate.head
  }
}

const shippedIds = new Set(shippedNow().map(lane => lane.id))
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
const stillOpen = dedupe(open)
const blockingOpen = stillOpen.filter(blocking)
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
    round: lane.round,
    status: lane.status,
    merged: lane.merged,
    attempts: lane.attempts || 0,
    decisions: lane.report ? lane.report.decisions || [] : [],
    notes: lane.report ? lane.report.open || [] : [],
    outside: lane.outside || [],
  })),
  // Done-when items of shipped lanes that no automated test proves: for the PR's manual checks.
  untestable,
  // Done-when items of shipped lanes left unmet because a lane they need didn't ship.
  blocked: blockedItems,
  // Failures lanes met outside their own files that also fail on the branch.
  foreign,
  reviews,
  // green is the checks. A green gate's failures are the must and security findings still open, which keep the run from DONE.
  gate: gate
    ? {
        green,
        checks: gate.checks,
        failures: green ? blockingOpen.map(f => ({ problem: describe(f), files: filesOf(f) })) : gate.failures || [],
      }
    : { green: false, checks: [], note: FULL.length ? 'the gate did not run' : 'the plan lists no checks' },
  // Findings whose fix lanes merged, every round's; nits get no fix lane, so they are in reviews.
  fixed: closed.map(describe),
  open: stillOpen.map(describe),
  security: stillOpen.filter(f => f.security === true).map(describe),
  questions,
  stopped,
  // Output tokens this turn spent, the workflow's agents and the main loop's: what the ship phase cost.
  tokens: typeof budget !== 'undefined' ? budget.spent() : null,
  // Worktrees of lanes that never merged, fix lanes included, for the main session to remove.
  leftover: lanes.filter(lane => !lane.merged).map(lane => `${plan.repo}/.claude/worktrees/lane-${lane.id}`),
}
