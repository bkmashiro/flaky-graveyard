import { promises as fs } from 'node:fs'
import path from 'node:path'

function getRequiredInput(name) {
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`
  const value = process.env[envName]?.trim()
  if (!value) {
    throw new Error(`Missing required input: ${name}`)
  }
  return value
}

function getInput(name, fallback = '') {
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`
  return process.env[envName]?.trim() || fallback
}

function escapeRegex(char) {
  return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegex(pattern) {
  let regex = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const next = pattern[index + 1]

    if (char === '*') {
      if (next === '*') {
        const after = pattern[index + 2]
        if (after === '/') {
          regex += '(?:.*/)?'
          index += 2
        } else {
          regex += '.*'
          index += 1
        }
      } else {
        regex += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      regex += '.'
      continue
    }

    regex += escapeRegex(char)
  }

  return new RegExp(`${regex}$`)
}

async function walk(dir, rootDir, patterns, matches) {
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue
    }

    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/')

    if (entry.isDirectory()) {
      await walk(fullPath, rootDir, patterns, matches)
      continue
    }

    if (patterns.some((pattern) => pattern.test(relativePath))) {
      matches.push(fullPath)
    }
  }
}

async function findJUnitFiles(workspace, rawPatterns) {
  const patterns = rawPatterns
    .split(/\r?\n|,/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(globToRegex)

  const matches = []
  await walk(workspace, workspace, patterns, matches)
  matches.sort()
  return matches
}

async function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    return {}
  }

  try {
    return JSON.parse(await fs.readFile(eventPath, 'utf8'))
  } catch {
    return {}
  }
}

function formatTrend(trend) {
  if (trend === 'getting-worse') return 'worse'
  if (trend === 'getting-better') return 'better'
  return 'stable'
}

function buildCommentBody(summary, flakyTests, dashboardUrl) {
  const lines = [
    '## Flaky Graveyard report',
    '',
    `Ingested ${summary.stats.total} test results from ${summary.filesProcessed} JUnit file(s).`,
    '',
  ]

  if (flakyTests.length === 0) {
    lines.push('No flaky tests are currently above the reporting threshold.')
  } else {
    lines.push('| Test | Suite | Score | Runs | Trend |')
    lines.push('| --- | --- | ---: | ---: | --- |')
    for (const test of flakyTests) {
      lines.push(
        `| ${test.testName} | ${test.suite || '-'} | ${(test.score * 100).toFixed(1)}% | ${test.totalRuns} | ${formatTrend(test.trend)} |`
      )
    }
  }

  lines.push('')
  lines.push(`[Open dashboard](${dashboardUrl})`)
  return lines.join('\n')
}

async function postComment(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'flaky-graveyard-action',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(
      `GitHub comment failed: ${response.status} ${await response.text()}`
    )
  }
}

async function main() {
  const serverUrl = getRequiredInput('server-url').replace(/\/$/, '')
  const junitGlob = getInput('junit-glob', '**/test-results/*.xml')
  const token = getRequiredInput('token')
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const repository = process.env.GITHUB_REPOSITORY || path.basename(workspace)
  const branch =
    process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown'
  const commitSha = process.env.GITHUB_SHA || ''

  const files = await findJUnitFiles(workspace, junitGlob)
  if (files.length === 0) {
    throw new Error(`No JUnit XML files matched: ${junitGlob}`)
  }

  const junitXmlFiles = await Promise.all(
    files.map((file) => fs.readFile(file, 'utf8'))
  )

  const ingestResponse = await fetch(`${serverUrl}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'flaky-graveyard-action',
    },
    body: JSON.stringify({
      project: repository,
      branch,
      commitSha,
      junitXmlFiles,
    }),
  })

  if (!ingestResponse.ok) {
    throw new Error(
      `Ingest failed: ${ingestResponse.status} ${await ingestResponse.text()}`
    )
  }

  const ingestSummary = await ingestResponse.json()
  const flakyResponse = await fetch(
    `${serverUrl}/api/flaky?project=${encodeURIComponent(repository)}&threshold=0.1&limit=10`,
    {
      headers: { 'User-Agent': 'flaky-graveyard-action' },
    }
  )

  if (!flakyResponse.ok) {
    throw new Error(
      `Fetching flaky tests failed: ${flakyResponse.status} ${await flakyResponse.text()}`
    )
  }

  const flakyTests = await flakyResponse.json()
  const dashboardUrl = `${serverUrl}/dashboard?project=${encodeURIComponent(repository)}`
  const commentBody = buildCommentBody(
    ingestSummary,
    flakyTests,
    dashboardUrl
  )

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `${commentBody}\n`,
      'utf8'
    )
  }

  const event = await readEventPayload()
  const prNumber = event.pull_request?.number
  if (!prNumber) {
    console.log('No pull_request context detected; skipping PR comment.')
    return
  }

  await postComment(
    `https://api.github.com/repos/${repository}/issues/${prNumber}/comments`,
    token,
    { body: commentBody }
  )
  console.log(`Posted flaky report comment to PR #${prNumber}.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
