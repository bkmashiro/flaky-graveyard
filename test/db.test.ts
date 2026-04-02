const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Database = require('better-sqlite3')
const {
  getExportableTests,
  getDb,
  getProjectStats,
  getRetryAttempts,
  getTestHistory,
  getTopFlakyTests,
  initDb,
  insertRetryAttempt,
  insertRun,
  insertTestResult,
} = require('../src/db.ts')
const { calculateFlakinessScore } = require('../src/flakiness.ts')

function createDb() {
  return initDb(new Database(':memory:'))
}

function insertRunWithResult(
  db: Database.Database,
  options: {
    project?: string
    suite?: string
    testName?: string
    status?: 'pass' | 'fail' | 'skip'
    durationMs?: number
  } = {}
) {
  const project = options.project ?? 'demo-project'
  const suite = options.suite ?? 'AuthSuite'
  const testName = options.testName ?? 'logs in'
  const status = options.status ?? 'pass'
  const durationMs = options.durationMs ?? 10

  const runId = insertRun(db, project)
  insertTestResult(db, runId, suite, testName, status, durationMs)
}

test('can insert a test run', () => {
  const db = createDb()

  const runId = insertRun(db, 'demo-project', 'main', 'abc123')

  const row = db
    .prepare('SELECT project, branch, commit_sha FROM runs WHERE id = ?')
    .get(runId) as { project: string; branch: string; commit_sha: string }

  assert.equal(row.project, 'demo-project')
  assert.equal(row.branch, 'main')
  assert.equal(row.commit_sha, 'abc123')
})

test('can retrieve test run history', () => {
  const db = createDb()

  insertRunWithResult(db, { status: 'pass' })
  insertRunWithResult(db, { status: 'fail' })
  insertRunWithResult(db, { status: 'pass' })

  const history = getTestHistory(db, 'logs in', 'AuthSuite', 'demo-project', 10)

  assert.equal(history.length, 3)
  assert.deepEqual(
    history.map((entry) => entry.status).sort(),
    ['fail', 'pass', 'pass']
  )
})

test('can calculate flakiness score from stored runs', () => {
  const db = createDb()

  insertRunWithResult(db, { status: 'pass' })
  insertRunWithResult(db, { status: 'fail' })
  insertRunWithResult(db, { status: 'pass' })
  insertRunWithResult(db, { status: 'fail' })

  const history = getTestHistory(db, 'logs in', 'AuthSuite', 'demo-project', 10)
  const score = calculateFlakinessScore(history)

  assert.equal(history.length, 4)
  assert.equal(history.filter((entry) => entry.status === 'fail').length, 2)
  assert.equal(score, 50)
})

test('deduplicates history by test name and suite', () => {
  const db = createDb()

  insertRunWithResult(db, { suite: 'AuthSuite', testName: 'shared name', status: 'fail' })
  insertRunWithResult(db, { suite: 'PaymentsSuite', testName: 'shared name', status: 'pass' })

  const authHistory = getTestHistory(db, 'shared name', 'AuthSuite', 'demo-project', 10)
  const paymentsHistory = getTestHistory(db, 'shared name', 'PaymentsSuite', 'demo-project', 10)

  assert.equal(authHistory.length, 1)
  assert.equal(paymentsHistory.length, 1)
  assert.equal(authHistory[0]?.status, 'fail')
  assert.equal(paymentsHistory[0]?.status, 'pass')
})

test('stores nullable suite, duration, and error fields as null', () => {
  const db = createDb()
  const runId = insertRun(db, 'demo-project')

  insertTestResult(db, runId, undefined, 'handles missing metadata', 'skip')

  const row = db
    .prepare(
      'SELECT suite, duration_ms, error_message FROM test_results WHERE test_name = ?'
    )
    .get('handles missing metadata') as {
      suite: string | null
      duration_ms: number | null
      error_message: string | null
    }

  assert.equal(row.suite, null)
  assert.equal(row.duration_ms, null)
  assert.equal(row.error_message, null)
})

test('stores retry attempts for a failing test result', () => {
  const db = createDb()
  const runId = insertRun(db, 'demo-project')
  const testResultId = insertTestResult(
    db,
    runId,
    'AuthSuite',
    'logs in',
    'fail',
    12,
    'timeout'
  )

  insertRetryAttempt(db, testResultId, 1, 'pass', 9)
  insertRetryAttempt(db, testResultId, 2, 'fail', 11, 'timeout again')

  const attempts = getRetryAttempts(db, testResultId)

  assert.equal(attempts.length, 2)
  assert.deepEqual(
    attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
    })),
    [
      { attemptIndex: 1, status: 'pass' },
      { attemptIndex: 2, status: 'fail' },
    ]
  )
  assert.equal(attempts[1]?.errorMessage, 'timeout again')
})

test('returns project stats for a single project', () => {
  const db = createDb()

  insertRunWithResult(db, { project: 'alpha', testName: 'alpha one', status: 'pass' })
  insertRunWithResult(db, { project: 'alpha', testName: 'alpha two', status: 'fail' })
  insertRunWithResult(db, { project: 'beta', testName: 'beta one', status: 'fail' })

  const stats = getProjectStats(db, 'alpha')

  assert.deepEqual(stats, { totalTests: 2, totalRuns: 2 })
})

test('returns only flaky tests above the threshold and respects the limit', () => {
  const db = createDb()

  insertRunWithResult(db, { project: 'alpha', suite: 'SuiteA', testName: 'always fails', status: 'fail' })
  insertRunWithResult(db, { project: 'alpha', suite: 'SuiteA', testName: 'always fails', status: 'fail' })
  insertRunWithResult(db, { project: 'alpha', suite: 'SuiteB', testName: 'mixed results', status: 'fail' })
  insertRunWithResult(db, { project: 'alpha', suite: 'SuiteB', testName: 'mixed results', status: 'pass' })
  insertRunWithResult(db, { project: 'alpha', suite: 'SuiteC', testName: 'mostly passing', status: 'pass' })
  insertRunWithResult(db, { project: 'alpha', suite: 'SuiteC', testName: 'mostly passing', status: 'pass' })
  insertRunWithResult(db, { project: 'beta', suite: 'SuiteZ', testName: 'other project', status: 'fail' })

  const flaky = getTopFlakyTests(db, 'alpha', 0.5, 1)

  assert.equal(flaky.length, 1)
  assert.equal(flaky[0]?.testName, 'always fails')
  assert.equal(flaky[0]?.suite, 'SuiteA')
  assert.equal(flaky[0]?.failCount, 2)
  assert.equal(flaky[0]?.totalRuns, 2)
  assert.ok(typeof flaky[0]?.lastSeen === 'string')
})

test('returns exportable tests with latest failure metadata', () => {
  const db = createDb()

  insertRunWithResult(db, {
    project: 'alpha',
    suite: 'AuthSuite',
    testName: 'login',
    status: 'fail',
  })
  insertRunWithResult(db, {
    project: 'alpha',
    suite: 'AuthSuite',
    testName: 'login',
    status: 'pass',
  })
  const stableRunId = insertRun(db, 'alpha')
  insertTestResult(db, stableRunId, 'DbSuite', 'connects', 'fail', 5, 'db down')
  insertTestResult(db, stableRunId, 'DbSuite', 'connects', 'fail', 5, 'db still down')

  const rows = getExportableTests(db, 'alpha')

  assert.equal(rows.length, 2)
  const login = rows.find((row) => row.testName === 'login')
  const connects = rows.find((row) => row.testName === 'connects')

  assert.equal(login?.suite, 'AuthSuite')
  assert.equal(login?.failCount, 1)
  assert.equal(login?.totalRuns, 2)
  assert.ok(typeof login?.lastFailureAt === 'string')
  assert.equal(connects?.lastFailureMessage, 'db still down')
})

test('creates a database file and reuses the same connection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flaky-graveyard-'))
  const dbPath = join(dir, 'nested', 'graveyard.db')

  const first = getDb(dbPath)
  const second = getDb(join(dir, 'ignored.db'))

  assert.equal(first, second)
  assert.equal(existsSync(dbPath), true)
})
