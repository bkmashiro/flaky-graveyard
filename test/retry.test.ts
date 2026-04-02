const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { getRetryAttempts, initDb, insertRun, insertTestResult } = require('../src/db.ts')
const {
  classifyRetryOutcome,
  formatRetryOutcome,
  retryFailedTests,
} = require('../src/retry.ts')

function createDb() {
  return initDb(new Database(':memory:'))
}

test('classifies mixed retry results as flaky', () => {
  const outcome = classifyRetryOutcome([
    { status: 'fail', durationMs: 0 },
    { status: 'pass', durationMs: 1 },
    { status: 'pass', durationMs: 1 },
    { status: 'fail', durationMs: 1 },
  ])

  assert.deepEqual(outcome, {
    failureCount: 2,
    failureRate: 0.5,
    classification: 'flaky',
  })
})

test('persists retry attempts and returns stable-failure when all retries fail', async () => {
  const db = createDb()
  const runId = insertRun(db, 'demo-project')
  const testResultId = insertTestResult(
    db,
    runId,
    'db',
    'connect',
    'fail',
    3,
    'initial fail'
  )
  const outcomes = await retryFailedTests(
    db,
    [
      {
        testResultId,
        suite: 'db',
        testName: 'connect',
        errorMessage: 'initial fail',
      },
    ],
    3,
    async () => ({ status: 'fail', durationMs: 7, errorMessage: 'still failing' })
  )

  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0]?.classification, 'stable-failure')
  assert.equal(outcomes[0]?.failureCount, 4)

  const attempts = getRetryAttempts(db, testResultId)
  assert.equal(attempts.length, 3)
  assert.equal(attempts[0]?.attemptIndex, 1)
  assert.equal(attempts[2]?.status, 'fail')
})

test('formats retry output with the failure ratio', () => {
  const line = formatRetryOutcome({
    suite: 'auth',
    testName: 'login',
    attempts: [
      { status: 'fail', durationMs: 0 },
      { status: 'pass', durationMs: 4 },
      { status: 'pass', durationMs: 5 },
      { status: 'pass', durationMs: 6 },
    ],
    failureCount: 1,
    failureRate: 0.25,
    classification: 'flaky',
  })

  assert.match(line, /auth\.login: FAIL -> PASS -> PASS -> PASS -> FLAKY/)
  assert.match(line, /\(1\/4 failures = 25%\)/)
})
