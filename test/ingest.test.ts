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

test('parses skipped tests and defaults missing fields', () => {
  const [result] = parseJUnitXml(`
    <testsuite>
      <testcase>
        <skipped />
      </testcase>
    </testsuite>
  `)

  assert.equal(result?.suite, 'unknown')
  assert.equal(result?.testName, 'unknown')
  assert.equal(result?.status, 'skip')
  assert.equal(result?.durationMs, 0)
})

test('parses string error bodies from a root testsuite payload', () => {
  const [result] = parseJUnitXml(`
    <testsuite name="RootSuite">
      <testcase name="explodes" time="0.5">
        <error>kaboom</error>
      </testcase>
    </testsuite>
  `)

  assert.equal(result?.suite, 'RootSuite')
  assert.equal(result?.testName, 'explodes')
  assert.equal(result?.status, 'fail')
  assert.equal(result?.durationMs, 500)
  assert.equal(result?.errorMessage, 'kaboom')
})
