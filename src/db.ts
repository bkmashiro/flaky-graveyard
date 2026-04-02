import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { dirname } from 'path'

let _db: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  branch TEXT,
  commit_sha TEXT,
  run_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id),
  suite TEXT,
  test_name TEXT NOT NULL,
  status TEXT CHECK(status IN ('pass', 'fail', 'skip')),
  duration_ms REAL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_test_name ON test_results(test_name);
CREATE INDEX IF NOT EXISTS idx_run_project ON runs(project);
`

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db

  const resolvedPath =
    dbPath ??
    process.env.DB_PATH ??
    `${homedir()}/.flaky-graveyard/data.db`

  mkdirSync(dirname(resolvedPath), { recursive: true })
  _db = new Database(resolvedPath)
  _db.exec(SCHEMA)
  return _db
}

export function insertRun(
  db: Database.Database,
  project: string,
  branch?: string,
  commitSha?: string
): number {
  const stmt = db.prepare(
    'INSERT INTO runs (project, branch, commit_sha) VALUES (?, ?, ?)'
  )
  const result = stmt.run(project, branch ?? null, commitSha ?? null)
  return result.lastInsertRowid as number
}

export function insertTestResult(
  db: Database.Database,
  runId: number,
  suite: string | undefined,
  testName: string,
  status: 'pass' | 'fail' | 'skip',
  durationMs?: number,
  errorMessage?: string
): void {
  const stmt = db.prepare(
    `INSERT INTO test_results (run_id, suite, test_name, status, duration_ms, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  stmt.run(
    runId,
    suite ?? null,
    testName,
    status,
    durationMs ?? null,
    errorMessage ?? null
  )
}

export interface HistoryEntry {
  status: string
  run_at: string
}

export function getTestHistory(
  db: Database.Database,
  testName: string,
  project: string,
  window: number
): HistoryEntry[] {
  const stmt = db.prepare(`
    SELECT tr.status, r.run_at
    FROM test_results tr
    JOIN runs r ON tr.run_id = r.id
    WHERE tr.test_name = ? AND r.project = ?
    ORDER BY r.run_at DESC
    LIMIT ?
  `)
  return stmt.all(testName, project, window) as HistoryEntry[]
}

export interface ProjectStats {
  totalTests: number
  totalRuns: number
}

export function getProjectStats(
  db: Database.Database,
  project: string
): ProjectStats {
  const runsStmt = db.prepare(
    'SELECT COUNT(*) as count FROM runs WHERE project = ?'
  )
  const testsStmt = db.prepare(`
    SELECT COUNT(DISTINCT test_name) as count
    FROM test_results tr
    JOIN runs r ON tr.run_id = r.id
    WHERE r.project = ?
  `)
  const runsResult = runsStmt.get(project) as { count: number }
  const testsResult = testsStmt.get(project) as { count: number }
  return {
    totalTests: testsResult.count,
    totalRuns: runsResult.count,
  }
}

export interface FlakyTestRow {
  testName: string
  suite: string | null
  failCount: number
  totalRuns: number
  lastSeen: string
}

export function getTopFlakyTests(
  db: Database.Database,
  project: string,
  threshold: number,
  limit: number
): FlakyTestRow[] {
  const stmt = db.prepare(`
    SELECT
      tr.test_name as testName,
      tr.suite,
      SUM(CASE WHEN tr.status = 'fail' THEN 1 ELSE 0 END) as failCount,
      COUNT(*) as totalRuns,
      MAX(r.run_at) as lastSeen
    FROM test_results tr
    JOIN runs r ON tr.run_id = r.id
    WHERE r.project = ?
    GROUP BY tr.test_name, tr.suite
    HAVING CAST(failCount AS REAL) / totalRuns >= ?
    ORDER BY CAST(failCount AS REAL) / totalRuns DESC
    LIMIT ?
  `)
  return stmt.all(project, threshold, limit) as FlakyTestRow[]
}
