const test = require('node:test')
const assert = require('node:assert/strict')
const { buildJUnitExport } = require('../src/junit-export.ts')

test('exports flaky tests as JUnit XML', () => {
  const xml = buildJUnitExport([
    {
      suite: 'auth',
      testName: 'login',
      failCount: 3,
      totalRuns: 10,
      lastFailureAt: '2024-03-20T12:00:00.000Z',
      lastFailureMessage: 'invalid token',
    },
    {
      suite: 'db',
      testName: 'connect',
      failCount: 5,
      totalRuns: 5,
      lastFailureAt: '2024-03-21T12:00:00.000Z',
      lastFailureMessage: 'db offline',
    },
  ])

  assert.match(xml, /<testsuites name="flaky-graveyard" tests="1" failures="1">/)
  assert.match(xml, /<testsuite name="auth" tests="1" failures="1">/)
  assert.match(xml, /<testcase name="login" classname="auth\.login">/)
  assert.match(xml, /message="Flaky: 3\/10 runs failed \(30%\)"/)
  assert.match(xml, /Last failure: 2024-03-20/)
  assert.match(xml, /Message: invalid token/)
  assert.doesNotMatch(xml, /db\.connect/)
})

test('escapes XML-sensitive characters in suite, test, and message content', () => {
  const xml = buildJUnitExport([
    {
      suite: 'auth<&>',
      testName: `login"test`,
      failCount: 1,
      totalRuns: 2,
      lastFailureAt: '2024-03-20T12:00:00.000Z',
      lastFailureMessage: `bad <xml> & "quotes"`,
    },
  ])

  assert.match(xml, /testsuite name="auth&lt;&amp;&gt;"/)
  assert.match(xml, /testcase name="login&quot;test"/)
  assert.match(xml, /Message: bad &lt;xml&gt; &amp; &quot;quotes&quot;/)
})
