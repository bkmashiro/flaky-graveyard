#!/usr/bin/env tsx
import { Command } from 'commander'
import { readFileSync } from 'fs'
import chalk from 'chalk'
import { getDb, insertRun, insertTestResult, getProjectStats } from './db.js'
import { parseJUnitXml } from './ingest.js'
import { getTopFlaky } from './scorer.js'

const program = new Command()
program.name('flaky-graveyard').description('Self-hosted flaky test tracker').version('1.0.0')

// Upload command
program
  .command('upload <file>')
  .description('Upload a JUnit XML test report')
  .option('--project <name>', 'project name')
  .option('--branch <branch>', 'git branch')
  .option('--commit <sha>', 'commit SHA')
  .option('--server <url>', 'server URL', 'http://localhost:3000')
  .option('--local', 'use local SQLite DB directly')
  .action(async (file: string, opts: { project?: string; branch?: string; commit?: string; server: string; local?: boolean }) => {
    try {
      const xml = readFileSync(file, 'utf-8')
      const project = opts.project ?? 'default'

      if (opts.local) {
        const db = getDb()
        const runId = insertRun(db, project, opts.branch, opts.commit)
        const results = parseJUnitXml(xml)
        let pass = 0, fail = 0, skip = 0
        for (const r of results) {
          insertTestResult(db, runId, r.suite, r.testName, r.status, r.durationMs, r.errorMessage)
          if (r.status === 'pass') pass++
          else if (r.status === 'fail') fail++
          else skip++
        }
        console.log(chalk.green(`✓ Uploaded ${results.length} tests (run #${runId})`))
        console.log(`  pass: ${pass}, fail: ${fail}, skip: ${skip}`)
      } else {
        const response = await fetch(`${opts.server}/api/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, branch: opts.branch, commitSha: opts.commit, junitXml: xml }),
        })
        if (!response.ok) {
          const err = await response.text()
          console.error(chalk.red(`Error: ${err}`))
          process.exit(1)
        }
        const data = await response.json() as { runId: number; stats: { total: number; pass: number; fail: number; skip: number } }
        console.log(chalk.green(`✓ Uploaded ${data.stats.total} tests (run #${data.runId})`))
        console.log(`  pass: ${data.stats.pass}, fail: ${data.stats.fail}, skip: ${data.stats.skip}`)
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${String(err)}`))
      process.exit(1)
    }
  })

// List command
program
  .command('list')
  .description('List flaky tests for a project')
  .option('--project <name>', 'project name (required)')
  .option('--threshold <n>', 'flakiness threshold', '0.1')
  .option('--limit <n>', 'max results', '20')
  .option('--server <url>', 'server URL', 'http://localhost:3000')
  .option('--local', 'use local SQLite DB directly')
  .action(async (opts: { project?: string; threshold: string; limit: string; server: string; local?: boolean }) => {
    try {
      if (!opts.project) {
        console.error(chalk.red('Error: --project is required'))
        process.exit(1)
      }

      const threshold = parseFloat(opts.threshold)
      const limit = parseInt(opts.limit, 10)

      if (opts.local) {
        const db = getDb()
        const flaky = getTopFlaky(db, opts.project, threshold, limit)
        printFlakyTable(flaky, opts.project, threshold)
      } else {
        const url = `${opts.server}/api/flaky?project=${encodeURIComponent(opts.project)}&threshold=${threshold}&limit=${limit}`
        const response = await fetch(url)
        if (!response.ok) {
          const err = await response.text()
          console.error(chalk.red(`Error: ${err}`))
          process.exit(1)
        }
        const flaky = await response.json() as Array<{
          testName: string; suite: string; score: number; totalRuns: number; failCount: number; trend: string; lastSeen: string
        }>
        printFlakyTable(flaky, opts.project, threshold)
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${String(err)}`))
      process.exit(1)
    }
  })

// Report command
program
  .command('report')
  .description('Generate a markdown report')
  .option('--project <name>', 'project name (required)')
  .option('--branch <branch>', 'filter by branch')
  .option('--server <url>', 'server URL', 'http://localhost:3000')
  .option('--local', 'use local SQLite DB directly')
  .action(async (opts: { project?: string; branch?: string; server: string; local?: boolean }) => {
    try {
      if (!opts.project) {
        console.error(chalk.red('Error: --project is required'))
        process.exit(1)
      }

      if (opts.local) {
        const db = getDb()
        const flaky = getTopFlaky(db, opts.project, 0.1, 20)
        const stats = getProjectStats(db, opts.project)
        printReport(flaky, opts.project, stats)
      } else {
        let url = `${opts.server}/api/report?project=${encodeURIComponent(opts.project)}`
        if (opts.branch) url += `&branch=${encodeURIComponent(opts.branch)}`
        const response = await fetch(url)
        if (!response.ok) {
          const err = await response.text()
          console.error(chalk.red(`Error: ${err}`))
          process.exit(1)
        }
        const text = await response.text()
        console.log(text)
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${String(err)}`))
      process.exit(1)
    }
  })

interface FlakyEntry {
  testName: string
  suite: string
  score: number
  totalRuns: number
  failCount: number
  trend: string
  lastSeen: string
}

function scoreColor(score: number, text: string): string {
  if (score > 0.3) return chalk.red(text)
  if (score >= 0.1) return chalk.yellow(text)
  return chalk.green(text)
}

function trendDisplay(trend: string): string {
  if (trend === 'getting-worse') return chalk.red('↑ worse')
  if (trend === 'getting-better') return chalk.green('↓ better')
  return chalk.yellow('→ stable')
}

function printFlakyTable(flaky: FlakyEntry[], project: string, threshold: number): void {
  console.log(chalk.gray('─'.repeat(70)))
  console.log(chalk.bold(`🪦 Flaky Tests: ${project}`))
  console.log()

  if (flaky.length === 0) {
    console.log(chalk.green('  No flaky tests found above threshold.'))
    console.log(chalk.gray('─'.repeat(70)))
    return
  }

  const header = '  SCORE  TEST                              SUITE        RUNS  TREND'
  console.log(chalk.bold(header))
  console.log('  ' + '─'.repeat(66))

  for (const f of flaky) {
    const score = f.score.toFixed(2)
    const testCol = `${f.suite}::${f.testName}`.padEnd(34)
    const suiteCol = f.suite.padEnd(12)
    const runsCol = String(f.totalRuns).padStart(4)
    console.log(
      `  ${scoreColor(f.score, score.padEnd(6))} ${testCol} ${suiteCol} ${runsCol}   ${trendDisplay(f.trend)}`
    )
  }
  console.log(chalk.gray('─'.repeat(70)))
}

function printReport(
  flaky: FlakyEntry[],
  project: string,
  stats: { totalTests: number; totalRuns: number }
): void {
  console.log(chalk.gray('─'.repeat(69)))
  console.log(chalk.bold(`🪦 Flaky Test Report: ${project} (last 30 runs)`))
  console.log()

  const header = '  SCORE  TEST                              SUITE        RUNS  TREND'
  console.log(chalk.bold(header))
  console.log('  ' + '─'.repeat(65))

  for (const f of flaky) {
    const score = f.score.toFixed(2)
    const label = `${f.testName}`
    const testCol = label.padEnd(34)
    const suiteCol = f.suite.padEnd(12)
    const runsCol = String(f.totalRuns).padStart(4)
    console.log(
      `  ${scoreColor(f.score, score.padEnd(6))} ${testCol} ${suiteCol} ${runsCol}   ${trendDisplay(f.trend)}`
    )
  }

  console.log()
  console.log(`  ${flaky.length} tests above threshold (0.10)`)
  console.log(`  Total tests tracked: ${stats.totalTests} | Total runs: ${stats.totalRuns}`)
  console.log(chalk.gray('─'.repeat(69)))
}

program.parse()
