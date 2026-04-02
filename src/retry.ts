import Database from 'better-sqlite3'
import { spawn } from 'child_process'
import { insertRetryAttempt } from './db.js'

export interface FailedTest {
  testResultId: number
  suite: string
  testName: string
  errorMessage?: string
}

export interface RetryAttempt {
  status: 'pass' | 'fail' | 'skip'
  durationMs: number
  errorMessage?: string
}

export interface RetryOutcome {
  suite: string
  testName: string
  attempts: RetryAttempt[]
  failureCount: number
  failureRate: number
  classification: 'flaky' | 'stable-failure'
}

export type RetryRunner = (
  test: FailedTest,
  attemptIndex: number
) => Promise<RetryAttempt>

export function classifyRetryOutcome(
  attempts: RetryAttempt[]
): Pick<RetryOutcome, 'failureCount' | 'failureRate' | 'classification'> {
  const failureCount = attempts.filter((attempt) => attempt.status === 'fail').length
  const failureRate = attempts.length === 0 ? 0 : failureCount / attempts.length

  return {
    failureCount,
    failureRate,
    classification:
      failureCount > 0 && failureCount < attempts.length ? 'flaky' : 'stable-failure',
  }
}

export async function retryFailedTests(
  db: Database.Database,
  failedTests: FailedTest[],
  retryCount: number,
  runner: RetryRunner
): Promise<RetryOutcome[]> {
  const outcomes: RetryOutcome[] = []

  for (const failedTest of failedTests) {
    const attempts: RetryAttempt[] = [
      {
        status: 'fail',
        durationMs: 0,
        errorMessage: failedTest.errorMessage,
      },
    ]

    for (let attemptIndex = 1; attemptIndex <= retryCount; attemptIndex += 1) {
      const attempt = await runner(failedTest, attemptIndex)
      attempts.push(attempt)
      insertRetryAttempt(
        db,
        failedTest.testResultId,
        attemptIndex,
        attempt.status,
        attempt.durationMs,
        attempt.errorMessage
      )
    }

    outcomes.push({
      suite: failedTest.suite,
      testName: failedTest.testName,
      attempts,
      ...classifyRetryOutcome(attempts),
    })
  }

  return outcomes
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function createCommandRetryRunner(commandTemplate: string): RetryRunner {
  return async (test, attemptIndex) => {
    const command = commandTemplate
      .replaceAll('{suite}', shellEscape(test.suite))
      .replaceAll('{test}', shellEscape(test.testName))
      .replaceAll('{attempt}', String(attemptIndex))

    return new Promise<RetryAttempt>((resolve, reject) => {
      const startedAt = Date.now()
      const child = spawn(command, {
        shell: true,
        env: {
          ...process.env,
          FLAKY_GRAVEYARD_SUITE: test.suite,
          FLAKY_GRAVEYARD_TEST_NAME: test.testName,
          FLAKY_GRAVEYARD_ATTEMPT: String(attemptIndex),
        },
      })

      let stderr = ''

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('error', reject)
      child.on('close', (code) => {
        resolve({
          status: code === 0 ? 'pass' : 'fail',
          durationMs: Date.now() - startedAt,
          errorMessage: stderr.trim() || undefined,
        })
      })
    })
  }
}

function formatAttemptStatus(status: RetryAttempt['status']): string {
  if (status === 'pass') return 'PASS'
  if (status === 'skip') return 'SKIP'
  return 'FAIL'
}

export function formatRetryOutcome(outcome: RetryOutcome): string {
  const name = outcome.suite
    ? `${outcome.suite}.${outcome.testName}`
    : outcome.testName
  const history = outcome.attempts.map((attempt) => formatAttemptStatus(attempt.status)).join(' -> ')
  const percentage = Math.round(outcome.failureRate * 100)
  const summary =
    outcome.classification === 'flaky'
      ? `FLAKY (${outcome.failureCount}/${outcome.attempts.length} failures = ${percentage}%)`
      : 'STABLE FAILURE (not flaky)'

  return `  ${name}: ${history} -> ${summary}`
}
