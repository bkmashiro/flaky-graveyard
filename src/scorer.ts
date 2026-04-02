import Database from 'better-sqlite3'
import { getTestHistory, getTopFlakyTests } from './db.js'

export interface FlakinessScore {
  testName: string
  suite: string
  totalRuns: number
  failCount: number
  score: number
  trend: 'stable' | 'getting-worse' | 'getting-better'
  lastSeen: string
}

function computeTrend(
  history: Array<{ status: string }>
): 'stable' | 'getting-worse' | 'getting-better' {
  if (history.length < 2) return 'stable'

  const last10 = history.slice(0, 10)
  const prev10 = history.slice(10, 20)

  if (prev10.length === 0) return 'stable'

  const last10Rate =
    last10.filter((h) => h.status === 'fail').length / last10.length
  const prev10Rate =
    prev10.filter((h) => h.status === 'fail').length / prev10.length

  if (last10Rate > prev10Rate + 0.1) return 'getting-worse'
  if (last10Rate < prev10Rate - 0.1) return 'getting-better'
  return 'stable'
}

export function calculateScore(
  db: Database.Database,
  testName: string,
  suite: string,
  project: string,
  window = 30
): FlakinessScore {
  const history = getTestHistory(db, testName, project, window)
  const failCount = history.filter((h) => h.status === 'fail').length
  const totalRuns = history.length
  const score = totalRuns > 0 ? failCount / totalRuns : 0
  const trend = computeTrend(history)
  const lastSeen = history.length > 0 ? history[0].run_at : ''

  return {
    testName,
    suite,
    totalRuns,
    failCount,
    score,
    trend,
    lastSeen,
  }
}

export function getTopFlaky(
  db: Database.Database,
  project: string,
  threshold = 0.1,
  limit = 20
): FlakinessScore[] {
  const rows = getTopFlakyTests(db, project, threshold, limit)
  return rows.map((row) => {
    return calculateScore(db, row.testName, row.suite ?? '', project)
  })
}
