const test = require('node:test')
const assert = require('node:assert/strict')
const {
  calculateFlakinessScore,
  classifyFlakinessScore,
} = require('../src/flakiness.ts')

function history(statuses: string[]) {
  return statuses.map((status) => ({ status }))
}

test('score is 0 when a test always passes', () => {
  assert.equal(calculateFlakinessScore(history(Array(10).fill('pass'))), 0)
})

test('score is 100 when a test always fails', () => {
  assert.equal(calculateFlakinessScore(history(Array(10).fill('fail'))), 100)
})

test('score is 50 when a test passes 50 percent of the time', () => {
  assert.equal(
    calculateFlakinessScore(
      history(['fail', 'pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'pass'])
    ),
    50
  )
})

test('score increases when recent runs are more flaky than historical', () => {
  const recentFailures = calculateFlakinessScore(
    history([
      'fail',
      'fail',
      'fail',
      'fail',
      'fail',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ])
  )
  const historicalFailures = calculateFlakinessScore(
    history([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'fail',
      'fail',
      'fail',
      'fail',
      'fail',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ])
  )

  assert.ok(recentFailures > historicalFailures)
})

test('returns stable classification for score below 20', () => {
  assert.equal(classifyFlakinessScore(19.9), 'stable')
})

test('returns flaky classification for score between 20 and 70', () => {
  assert.equal(classifyFlakinessScore(20), 'flaky')
  assert.equal(classifyFlakinessScore(70), 'flaky')
})

test('returns broken classification for score above 70', () => {
  assert.equal(classifyFlakinessScore(70.1), 'broken')
})
