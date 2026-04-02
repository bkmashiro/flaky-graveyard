# 🪦 Flaky Graveyard

A self-hosted flaky test tracker that ingests JUnit XML reports, scores test flakiness, and provides a web dashboard and CLI for visibility into unstable tests.

## What is it?

Flaky Graveyard collects test results from your CI runs, calculates a flakiness score for each test, identifies trends (getting worse / stable / getting better), and helps your team prioritize which tests to fix or quarantine.

## Why self-hosted?

- **Privacy**: Your test failures stay on your own infrastructure, never sent to a third party.
- **Cost**: No SaaS pricing per seat or per test run. Run it on a $5 VPS.
- **Customization**: Open source — fork it, extend it, integrate it however you like.
- **Simplicity**: One SQLite database, one Node process, one CLI.

## Quick Start

### Direct with Node

```bash
# Install dependencies
pnpm install

# Start the server
pnpm start
# => Flaky Graveyard server running on http://localhost:3000

# Upload a test report
pnpm cli upload --project myapp --branch main test-results.xml

# View the dashboard
open http://localhost:3000/dashboard?project=myapp
```

### Docker Compose

```yaml
version: '3.8'
services:
  flaky-graveyard:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - .:/app
      - flaky-data:/root/.flaky-graveyard
    command: sh -c "corepack enable && pnpm install && pnpm start"
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
volumes:
  flaky-data:
```

```bash
docker compose up -d
```

## GitHub Actions Integration

Add this to your workflow after running tests:

```yaml
- name: Upload test results to Flaky Graveyard
  if: always()
  run: |
    curl -s -X POST https://your-flaky-graveyard.example.com/api/runs \
      -H "Content-Type: application/json" \
      -d @- <<EOF
    {
      "project": "${{ github.repository }}",
      "branch": "${{ github.ref_name }}",
      "commitSha": "${{ github.sha }}",
      "junitXml": $(cat junit-results.xml | jq -Rs .)
    }
    EOF
```

Or use the CLI directly in your CI:

```yaml
- name: Upload test results
  if: always()
  run: |
    npx flaky-graveyard upload \
      --project "${{ github.repository }}" \
      --branch "${{ github.ref_name }}" \
      --commit "${{ github.sha }}" \
      --server https://your-flaky-graveyard.example.com \
      junit-results.xml
```

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
```
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

## API Reference

### `POST /api/runs`

Ingest a JUnit XML report.

**Body:**
```json
{
  "project": "myapp",
  "branch": "main",
  "commitSha": "abc123",
  "junitXml": "<testsuites>...</testsuites>"
}
```

**Response:**
```json
{
  "runId": 42,
  "stats": { "total": 10, "pass": 8, "fail": 2, "skip": 0 }
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

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `~/.flaky-graveyard/data.db` | SQLite database path |

## License

ISC
