import { XMLParser } from 'fast-xml-parser'

export interface TestResult {
  suite: string
  testName: string
  status: 'pass' | 'fail' | 'skip'
  durationMs: number
  errorMessage?: string
}

interface RawTestcase {
  '@_name'?: string
  '@_classname'?: string
  '@_time'?: string | number
  failure?: unknown
  error?: unknown
  skipped?: unknown
}

interface RawTestsuite {
  '@_name'?: string
  testcase?: RawTestcase | RawTestcase[]
}

interface ParsedXml {
  testsuites?: {
    testsuite?: RawTestsuite | RawTestsuite[]
  }
  testsuite?: RawTestsuite | RawTestsuite[]
}

function parseTestcase(tc: RawTestcase, suiteName: string): TestResult {
  const testName = tc['@_name'] ?? 'unknown'
  const time = tc['@_time']
  const durationMs = time !== undefined ? parseFloat(String(time)) * 1000 : 0

  let status: 'pass' | 'fail' | 'skip' = 'pass'
  let errorMessage: string | undefined

  if (tc.failure !== undefined || tc.error !== undefined) {
    status = 'fail'
    const failureOrError = tc.failure ?? tc.error
    if (typeof failureOrError === 'object' && failureOrError !== null) {
      const obj = failureOrError as Record<string, unknown>
      errorMessage = String(obj['@_message'] ?? obj['#text'] ?? '')
    } else if (typeof failureOrError === 'string') {
      errorMessage = failureOrError
    }
  } else if (tc.skipped !== undefined) {
    status = 'skip'
  }

  return {
    suite: suiteName,
    testName,
    status,
    durationMs,
    errorMessage,
  }
}

function parseSuite(suite: RawTestsuite): TestResult[] {
  const suiteName = suite['@_name'] ?? 'unknown'
  const testcases = suite.testcase
  if (!testcases) return []

  const cases = Array.isArray(testcases) ? testcases : [testcases]
  return cases.map((tc) => parseTestcase(tc, suiteName))
}

export function parseJUnitXml(xml: string): TestResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'testcase' || name === 'testsuite',
  })

  const parsed = parser.parse(xml) as ParsedXml
  const results: TestResult[] = []

  if (parsed.testsuites) {
    const suites = parsed.testsuites.testsuite
    if (suites) {
      const suiteArr = Array.isArray(suites) ? suites : [suites]
      for (const suite of suiteArr) {
        results.push(...parseSuite(suite))
      }
    }
  } else if (parsed.testsuite) {
    const suites = parsed.testsuite
    const suiteArr = Array.isArray(suites) ? suites : [suites]
    for (const suite of suiteArr) {
      results.push(...parseSuite(suite))
    }
  }

  return results
}
