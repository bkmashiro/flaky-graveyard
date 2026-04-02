export type ScoreClassification = 'stable' | 'flaky' | 'broken'

export function calculateFlakinessScore(
  history: Array<{ status: string }>
): number {
  const relevant = history.filter((entry) => entry.status !== 'skip')
  if (relevant.length === 0) return 0

  const failureRate =
    relevant.filter((entry) => entry.status === 'fail').length / relevant.length

  const recent = relevant.slice(0, 10)
  const historical = relevant.slice(10, 20)

  if (historical.length === 0) {
    return failureRate * 100
  }

  const recentFailureRate =
    recent.filter((entry) => entry.status === 'fail').length / recent.length
  const historicalFailureRate =
    historical.filter((entry) => entry.status === 'fail').length /
    historical.length

  const adjusted = failureRate + (recentFailureRate - historicalFailureRate) * 0.25
  return Math.max(0, Math.min(100, adjusted * 100))
}

export function classifyFlakinessScore(
  score: number
): ScoreClassification {
  if (score < 20) return 'stable'
  if (score <= 70) return 'flaky'
  return 'broken'
}
