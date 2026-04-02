import express from 'express'
import { getDb, insertRun, insertTestResult, getProjectStats } from './db.js'
import { parseJUnitXml } from './ingest.js'
import { getTopFlaky } from './scorer.js'

const app = express()
app.use(express.json({ limit: '10mb' }))

const PORT = parseInt(process.env.PORT ?? '3000', 10)

app.post('/api/runs', (req, res) => {
  try {
    const { project, branch, commitSha, junitXml } = req.body as {
      project?: string
      branch?: string
      commitSha?: string
      junitXml?: string
    }

    if (!project || !junitXml) {
      res.status(400).json({ error: 'project and junitXml are required' })
      return
    }

    const db = getDb()
    const runId = insertRun(db, project, branch, commitSha)
    const results = parseJUnitXml(junitXml)

    let pass = 0, fail = 0, skip = 0
    for (const r of results) {
      insertTestResult(db, runId, r.suite, r.testName, r.status, r.durationMs, r.errorMessage)
      if (r.status === 'pass') pass++
      else if (r.status === 'fail') fail++
      else skip++
    }

    res.json({ runId, stats: { total: results.length, pass, fail, skip } })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/flaky', (req, res) => {
  try {
    const project = req.query['project'] as string | undefined
    const threshold = parseFloat((req.query['threshold'] as string | undefined) ?? '0.1')
    const limit = parseInt((req.query['limit'] as string | undefined) ?? '20', 10)

    if (!project) {
      res.status(400).json({ error: 'project query param required' })
      return
    }

    const db = getDb()
    const flaky = getTopFlaky(db, project, threshold, limit)
    res.json(flaky)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/report', (req, res) => {
  try {
    const project = req.query['project'] as string | undefined
    const branch = req.query['branch'] as string | undefined

    if (!project) {
      res.status(400).json({ error: 'project query param required' })
      return
    }

    const db = getDb()
    const flaky = getTopFlaky(db, project, 0.1, 20)
    const stats = getProjectStats(db, project)

    const lines: string[] = []
    lines.push('─'.repeat(60))
    lines.push(`🪦 Flaky Test Report: ${project}${branch ? ` (${branch})` : ''}`)
    lines.push('')
    lines.push('  SCORE  TEST                              SUITE        RUNS  TREND')
    lines.push('  ' + '─'.repeat(65))

    for (const f of flaky) {
      const score = f.score.toFixed(2)
      const trend = f.trend === 'getting-worse' ? '↑ worse' : f.trend === 'getting-better' ? '↓ better' : '→ stable'
      const testCol = `${f.testName}`.padEnd(32)
      const suiteCol = f.suite.padEnd(12)
      lines.push(`  ${score.padEnd(6)} ${testCol} ${suiteCol} ${String(f.totalRuns).padStart(4)}   ${trend}`)
    }

    lines.push('')
    lines.push(`  ${flaky.length} tests above threshold (0.10)`)
    lines.push(`  Total tests tracked: ${stats.totalTests} | Total runs: ${stats.totalRuns}`)
    lines.push('─'.repeat(60))

    res.type('text/plain').send(lines.join('\n'))
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/dashboard', (req, res) => {
  try {
    const project = req.query['project'] as string | undefined
    const db = getDb()

    let projects: string[] = []
    const projStmt = db.prepare('SELECT DISTINCT project FROM runs ORDER BY project')
    projects = (projStmt.all() as { project: string }[]).map((r) => r.project)

    let rows: ReturnType<typeof getTopFlaky> = []
    if (project) {
      rows = getTopFlaky(db, project, 0, 50)
    }

    const scoreColor = (score: number) => {
      if (score > 0.3) return '#ffd6d6'
      if (score >= 0.1) return '#fff3cd'
      return '#d4edda'
    }

    const trendArrow = (trend: string) => {
      if (trend === 'getting-worse') return '↑'
      if (trend === 'getting-better') return '↓'
      return '→'
    }

    const projectOptions = projects
      .map((p) => `<option value="${p}" ${p === project ? 'selected' : ''}>${p}</option>`)
      .join('\n')

    const tableRows = rows
      .sort((a, b) => b.score - a.score)
      .map(
        (r) => `
        <tr style="background:${scoreColor(r.score)}">
          <td>${r.testName}</td>
          <td>${r.suite}</td>
          <td style="font-weight:bold">${(r.score * 100).toFixed(1)}%</td>
          <td>${r.totalRuns}</td>
          <td>${trendArrow(r.trend)}</td>
          <td>${r.lastSeen ? new Date(r.lastSeen).toLocaleString() : ''}</td>
        </tr>`
      )
      .join('\n')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flaky Graveyard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; margin: 0; padding: 20px; }
    h1 { color: #333; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 20px; }
    .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
    select, button { padding: 8px 16px; font-size: 14px; border: 1px solid #ddd; border-radius: 6px; }
    button { background: #4f46e5; color: white; border: none; cursor: pointer; }
    button:hover { background: #4338ca; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #1e293b; color: white; padding: 12px 16px; text-align: left; }
    td { padding: 10px 16px; border-bottom: 1px solid #f0f0f0; }
    tr:last-child td { border-bottom: none; }
    .legend { display: flex; gap: 16px; margin-top: 16px; font-size: 13px; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-box { width: 16px; height: 16px; border-radius: 3px; border: 1px solid #ddd; }
    .empty { text-align: center; padding: 40px; color: #666; }
  </style>
  <meta http-equiv="refresh" content="30">
</head>
<body>
  <h1>🪦 Flaky Graveyard</h1>
  <p class="subtitle">Self-hosted flaky test tracker</p>
  <div class="controls">
    <form method="get" action="/dashboard" style="display:flex;gap:8px;align-items:center">
      <select name="project">
        <option value="">-- Select project --</option>
        ${projectOptions}
      </select>
      <button type="submit">View</button>
    </form>
  </div>
  ${
    project
      ? rows.length > 0
        ? `<table>
    <thead>
      <tr>
        <th>Test Name</th>
        <th>Suite</th>
        <th>Flakiness Score</th>
        <th>Total Runs</th>
        <th>Trend</th>
        <th>Last Seen</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <div class="legend">
    <div class="legend-item"><div class="legend-box" style="background:#ffd6d6"></div> &gt;30% failure rate</div>
    <div class="legend-item"><div class="legend-box" style="background:#fff3cd"></div> 10–30% failure rate</div>
    <div class="legend-item"><div class="legend-box" style="background:#d4edda"></div> &lt;10% failure rate</div>
  </div>`
        : `<div class="empty">No flaky tests found for project <strong>${project}</strong>.</div>`
      : `<div class="empty">Select a project above to see its flaky tests.</div>`
  }
  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`

    res.type('html').send(html)
  } catch (err) {
    res.status(500).send('Internal server error: ' + String(err))
  }
})

app.listen(PORT, () => {
  console.log(`Flaky Graveyard server running on http://localhost:${PORT}`)
})

export default app
