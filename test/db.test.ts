const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const Database = require('better-sqlite3')
const {
  getDb,
  getProjectStats,
  getTestHistory,
  getTopFlakyTests,
  initDb,
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

test('creates a database file and reuses the same connection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flaky-graveyard-'))
  const dbPath = join(dir, 'nested', 'graveyard.db')

  const first = getDb(dbPath)
  const second = getDb(join(dir, 'ignored.db'))

  assert.equal(first, second)
  assert.equal(existsSync(dbPath), true)
})
