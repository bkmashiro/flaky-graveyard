const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { parseJUnitXml } = require('../src/ingest.ts')

function readFixture(name: string): string {
  return readFileSync(resolve('test/fixtures', name), 'utf8')
}

test('parses a simple JUnit XML with 1 passing test', () => {
  const results = parseJUnitXml(readFixture('junit-pass.xml'))

  assert.equal(results.length, 1)
  assert.equal(results[0]?.testName, 'adds numbers')
  assert.equal(results[0]?.suite, 'UnitSuite')
  assert.equal(results[0]?.status, 'pass')
})

test('parses JUnit XML with 1 failing test', () => {
  const results = parseJUnitXml(readFixture('junit-fail.xml'))

  assert.equal(results.length, 1)
  assert.equal(results[0]?.testName, 'rejects invalid input')
  assert.equal(results[0]?.status, 'fail')
  assert.match(results[0]?.errorMessage ?? '', /validation error/i)
})

test('parses JUnit XML with multiple test suites', () => {
  const results = parseJUnitXml(readFixture('junit-multi.xml'))

  assert.equal(results.length, 3)
  assert.deepEqual(
    results.map((result) => `${result.suite}::${result.testName}`),
    [
      'AuthSuite::logs in',
      'AuthSuite::rejects bad password',
      'ApiSuite::returns healthcheck',
    ]
  )
})

test('handles empty test suites', () => {
  const results = parseJUnitXml(readFixture('junit-multi.xml'))

  assert.equal(results.some((result) => result.suite === 'EmptySuite'), false)
})

test('correctly extracts duration in milliseconds', () => {
  const [result] = parseJUnitXml(readFixture('junit-pass.xml'))

  assert.equal(result?.durationMs, 123)
})

test('correctly extracts suite and test names for failures', () => {
  const [result] = parseJUnitXml(readFixture('junit-fail.xml'))

  assert.equal(result?.suite, 'UnitSuite')
  assert.equal(result?.testName, 'rejects invalid input')
})
