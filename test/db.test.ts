const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const {
  getTestHistory,
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
