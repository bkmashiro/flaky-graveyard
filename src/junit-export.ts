export interface ExportableTestRow {
  testName: string
  suite: string
  failCount: number
  totalRuns: number
  lastFailureAt: string | null
  lastFailureMessage: string | null
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function formatDate(value: string | null): string {
  if (!value) return 'unknown'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().slice(0, 10)
}

function buildFailureBody(row: ExportableTestRow): string {
  const rate = Math.round((row.failCount / row.totalRuns) * 100)
  const lines = [
    `Last failure: ${formatDate(row.lastFailureAt)}`,
    `Failure rate: ${rate}%`,
  ]

  if (row.lastFailureMessage) {
    lines.push(`Message: ${row.lastFailureMessage}`)
  }

  return lines.join('\n')
}

export function buildJUnitExport(
  rows: ExportableTestRow[],
  project = 'flaky-graveyard'
): string {
  const flakyRows = rows.filter(
    (row) => row.failCount > 0 && row.failCount < row.totalRuns
  )

  const grouped = new Map<string, ExportableTestRow[]>()
  for (const row of flakyRows) {
    const suiteName = row.suite || 'unknown'
    const suiteRows = grouped.get(suiteName) ?? []
    suiteRows.push(row)
    grouped.set(suiteName, suiteRows)
  }

  const tests = flakyRows.length
  const failures = flakyRows.length
  const suites = [...grouped.entries()]
    .map(([suiteName, suiteRows]) => {
      const cases = suiteRows
        .map((row) => {
          const rate = Math.round((row.failCount / row.totalRuns) * 100)
          const message = `Flaky: ${row.failCount}/${row.totalRuns} runs failed (${rate}%)`
          const body = buildFailureBody(row)
          const className = row.suite ? `${row.suite}.${row.testName}` : row.testName

          return [
            `    <testcase name="${xmlEscape(row.testName)}" classname="${xmlEscape(className)}">`,
            `      <failure message="${xmlEscape(message)}" type="FlakyTest">${xmlEscape(body)}</failure>`,
            '    </testcase>',
          ].join('\n')
        })
        .join('\n')

      return [
        `  <testsuite name="${xmlEscape(suiteName)}" tests="${suiteRows.length}" failures="${suiteRows.length}">`,
        cases,
        '  </testsuite>',
      ].join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xmlEscape(project)}" tests="${tests}" failures="${failures}">`,
    suites,
    '</testsuites>',
  ].join('\n')
}
