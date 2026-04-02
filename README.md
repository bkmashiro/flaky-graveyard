[![npm](https://img.shields.io/npm/v/flaky-graveyard)](https://www.npmjs.com/package/flaky-graveyard) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# 🪦 Flaky Graveyard

A self-hosted flaky test tracker that ingests JUnit XML reports, scores test flakiness, and provides a web dashboard, CLI, GitHub Action, and Docker deployment path for unstable test visibility.

## What is it?

Flaky Graveyard collects test results from your CI runs, calculates a flakiness score for each test, identifies trends (getting worse / stable / getting better), and helps your team prioritize which tests to fix or quarantine.

## Why self-hosted?

- **Privacy**: Your test failures stay on your own infrastructure, never sent to a third party.
- **Cost**: No SaaS pricing per seat or per test run. Run it on a $5 VPS.
- **Customization**: Open source; fork it, extend it, integrate it however you like.
- **Simplicity**: One SQLite database, one Node process, one CLI.

## Quick Start

### Direct with Node

```bash
pnpm install
pnpm build
pnpm start
# => Flaky Graveyard server running on http://localhost:3000
```

Upload a test report:

```bash
flaky-graveyard upload --project myapp --branch main --commit abc123 results.xml
```

Open the dashboard:

```bash
open http://localhost:3000/dashboard?project=myapp
```

### Docker Compose

```bash
pnpm build
docker compose up -d --build
```

This uses [Dockerfile](/Users/yuzhe/projects/flaky-graveyard/Dockerfile) and [docker-compose.yml](/Users/yuzhe/projects/flaky-graveyard/docker-compose.yml) to run the server on port `3000` and persist SQLite data under `./data`.

## Self-Hosting

### Docker

Build the production image after compiling the app:

```bash
pnpm build
docker build -t flaky-graveyard .
```

Run it directly:

```bash
docker run --name flaky-graveyard \
  -p 3000:3000 \
  -v "$(pwd)/data:/root/.flaky-graveyard" \
  --restart unless-stopped \
  flaky-graveyard
```

Or use Compose:

```bash
docker compose up -d --build
```

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `~/.flaky-graveyard/data.db` | SQLite database path |

## GitHub Actions Integration

Use the Marketplace action after your test step has produced JUnit XML:

```yaml
- name: Publish flaky report
  if: always()
  uses: bkmsr/flaky-graveyard@v1
  with:
    server-url: https://your-flaky-graveyard.example.com
    junit-glob: '**/test-results/*.xml'
    token: ${{ secrets.GITHUB_TOKEN }}
```

What the action does:

- Finds JUnit XML files matching `junit-glob`
- Sends them to `POST /api/ingest` as a single logical run
- Fetches the latest top flaky tests from `/api/flaky`
- Posts a pull request comment with the report when running in PR context

An example workflow is included at [.github/workflows/flaky-report.yml](/Users/yuzhe/projects/flaky-graveyard/.github/workflows/flaky-report.yml).

## CLI Usage

### Upload a test report

```bash
# Upload to a running server
flaky-graveyard upload --project myapp --branch main --commit abc123 results.xml

# Upload directly to local SQLite (no server needed)
flaky-graveyard upload --local --project myapp results.xml
```

### List flaky tests

```bash
# From server
flaky-graveyard list --project myapp --threshold 0.1 --limit 20

# From local DB
flaky-graveyard list --local --project myapp
```

Output:

```text
──────────────────────────────────────────────────────────────────────
🪦 Flaky Tests: myapp

  SCORE  TEST                              SUITE        RUNS  TREND
  ──────────────────────────────────────────────────────────────────
  0.73   AuthTests::should login with OTP  AuthTests      30   ↑ worse
  0.43   DbTests::connection timeout       DbTests        30   → stable
  0.17   ApiTests::rate limit              ApiTests       18   ↓ better
──────────────────────────────────────────────────────────────────────
```

### Generate a report

```bash
flaky-graveyard report --project myapp --branch main
flaky-graveyard report --local --project myapp
```

### Retry failed tests in CI

Re-run the failed tests from one or more JUnit reports and store the retry history in the local graveyard database:

```bash
export FLAKY_GRAVEYARD_RUNNER='pnpm test -- --grep {test}'
flaky-graveyard --project myapp --retry 3 --junit test-results/*.xml
```

`FLAKY_GRAVEYARD_RUNNER` (or `--runner`) is a shell command template. `{test}`, `{suite}`, and `{attempt}` are replaced before execution. A zero exit code counts as pass; any non-zero exit code counts as fail.

### Export as JUnit XML

Export the currently flaky tests for a project as JUnit XML:

```bash
flaky-graveyard --project myapp --export junit > flaky-report.xml
```

## API Reference

### `POST /api/ingest`

Ingest one or more JUnit XML reports as a single run.

**Body:**

```json
{
  "project": "myapp",
  "branch": "main",
  "commitSha": "abc123",
  "junitXmlFiles": [
    "<testsuites>...</testsuites>",
    "<testsuites>...</testsuites>"
  ]
}
```

**Response:**

```json
{
  "runId": 42,
  "filesProcessed": 2,
  "stats": { "total": 10, "pass": 8, "fail": 2, "skip": 0 }
}
```

### `POST /api/runs`

Backwards-compatible single-report ingest endpoint.

**Body:**

```json
{
  "project": "myapp",
  "branch": "main",
  "commitSha": "abc123",
  "junitXml": "<testsuites>...</testsuites>"
}
```

### `GET /api/flaky?project=myapp&threshold=0.1&limit=20`

Returns top flaky tests above the given threshold.

**Response:**

```json
[
  {
    "testName": "should login",
    "suite": "AuthTests",
    "totalRuns": 30,
    "failCount": 22,
    "score": 0.73,
    "trend": "getting-worse",
    "lastSeen": "2026-04-02T15:00:00Z"
  }
]
```

### `GET /api/report?project=myapp&branch=main`

Returns a plain-text formatted report.

### `GET /dashboard?project=myapp`

Web dashboard showing flaky tests with color-coded scores:

- Red: >30% failure rate
- Yellow: 10–30% failure rate
- Green: <10% failure rate

Auto-refreshes every 30 seconds.

## Scoring

**Flakiness score** = number of failures in last N runs / N (default window: 30)

**Trend** is computed by comparing the failure rate of the most recent 10 runs vs the previous 10 runs:

- `getting-worse`: last 10 rate > previous 10 rate + 10%
- `getting-better`: last 10 rate < previous 10 rate - 10%
- `stable`: otherwise

## License

ISC
