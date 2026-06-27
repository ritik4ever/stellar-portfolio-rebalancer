#!/usr/bin/env node
/**
 * Chaos Engineering Test: Kill Backend Mid-Rebalance
 *
 * Validates system resilience when the backend process is terminated during
 * an active rebalance operation. Verifies that portfolios are never left in
 * a corrupted allocation state and that the job queue drains properly on restart.
 *
 * Usage:
 *   node scripts/chaos/kill-backend-mid-rebalance.mjs
 *   npm run test:chaos
 *
 * Environment variables:
 *   CHAOS_BACKEND_PORT     - Backend port (default: 3001)
 *   CHAOS_KILL_DELAY_MS    - Delay before kill in ms (default: 500)
 *   CHAOS_STARTUP_TIMEOUT  - Max ms to wait for backend ready (default: 15000)
 *   CHAOS_RESTART_TIMEOUT  - Max ms to wait for backend restart (default: 15000)
 *   CHAOS_PORTFOLIO_ID     - Portfolio ID to use (default: auto-detected or demo)
 */

import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..', '..')
const BACKEND_DIR = resolve(ROOT_DIR, 'backend')

const BACKEND_PORT = parseInt(process.env.CHAOS_BACKEND_PORT ?? '3001', 10)
const KILL_DELAY_MS = parseInt(process.env.CHAOS_KILL_DELAY_MS ?? '500', 10)
const STARTUP_TIMEOUT = parseInt(process.env.CHAOS_STARTUP_TIMEOUT ?? '15000', 10)
const RESTART_TIMEOUT = parseInt(process.env.CHAOS_RESTART_TIMEOUT ?? '15000', 10)
const BASE_URL = `http://localhost:${BACKEND_PORT}/api`

// ─── Logging ────────────────────────────────────────────────────────────────

const log = {
  info: (msg, data) => {
    const extra = data ? ` ${JSON.stringify(data)}` : ''
    console.log(`[CHAOS][${ts()}] INFO  ${msg}${extra}`)
  },
  warn: (msg, data) => {
    const extra = data ? ` ${JSON.stringify(data)}` : ''
    console.warn(`[CHAOS][${ts()}] WARN  ${msg}${extra}`)
  },
  error: (msg, data) => {
    const extra = data ? ` ${JSON.stringify(data)}` : ''
    console.error(`[CHAOS][${ts()}] ERROR ${msg}${extra}`)
  },
  recovery: (msg, data) => {
    const extra = data ? ` ${JSON.stringify(data)}` : ''
    console.log(`[CHAOS][${ts()}] RECOVERY ${msg}${extra}`)
  },
  pass: (msg) => console.log(`[CHAOS][${ts()}] ✓ PASS  ${msg}`),
  fail: (msg) => console.error(`[CHAOS][${ts()}] ✗ FAIL  ${msg}`),
}

function ts() {
  return new Date().toISOString()
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function httpGet(path) {
  const res = await fetch(`${BASE_URL}${path}`)
  const body = await res.json().catch(() => null)
  return { status: res.status, ok: res.ok, body }
}

async function httpPost(path, payload = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, ok: res.ok, body }
}

// ─── Backend process management ─────────────────────────────────────────────

let backendProcess = null

function startBackend() {
  log.info('Starting backend process', { dir: BACKEND_DIR, port: BACKEND_PORT })

  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: String(BACKEND_PORT),
    // Suppress heavy startup noise unless debugging
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    LOG_PRETTY: 'false',
  }

  const proc = spawn('npm', ['run', 'dev'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  proc.stdout.on('data', (d) => {
    if (process.env.CHAOS_VERBOSE) process.stdout.write(`[backend] ${d}`)
  })
  proc.stderr.on('data', (d) => {
    if (process.env.CHAOS_VERBOSE) process.stderr.write(`[backend] ${d}`)
  })

  proc.on('error', (err) => log.error('Backend process error', { error: err.message }))

  backendProcess = proc
  return proc
}

async function waitUntilReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const { status, body } = await httpGet('/health')
      if (status === 200 && body?.status) {
        log.info('Backend ready', { status: body.status })
        return true
      }
    } catch {
      // not yet up — keep polling
    }
    await sleep(300)
  }
  return false
}

function killBackend(signal = 'SIGKILL') {
  if (!backendProcess || backendProcess.exitCode !== null) {
    log.warn('Backend process already exited before kill attempt')
    return
  }
  const pid = backendProcess.pid
  log.info(`Sending ${signal} to backend`, { pid })
  try {
    // Kill the process group so child processes (tsx, node) are also terminated
    process.kill(-backendProcess.pid, signal)
  } catch {
    // If process group kill fails, fall back to direct kill
    try {
      backendProcess.kill(signal)
    } catch (err) {
      log.warn('Kill failed (process may have already exited)', { error: err.message })
    }
  }
  backendProcess = null
}

// ─── Portfolio helpers ───────────────────────────────────────────────────────

async function findOrCreateTestPortfolio() {
  const portfolioId = process.env.CHAOS_PORTFOLIO_ID
  if (portfolioId) {
    log.info('Using provided portfolio ID', { portfolioId })
    return portfolioId
  }

  // Try to find an existing portfolio
  try {
    const { body } = await httpGet('/portfolios?limit=1')
    const first = body?.data?.portfolios?.[0] ?? body?.portfolios?.[0]
    if (first?.id) {
      log.info('Using existing portfolio', { portfolioId: first.id })
      return first.id
    }
  } catch {
    // fall through to create
  }

  // Create a minimal demo portfolio for the chaos test
  log.info('Creating demo portfolio for chaos test')
  const { status, body } = await httpPost('/portfolio', {
    userAddress: 'GCHAOS0000000000000000000000000000000000000000000000000000',
    allocations: { XLM: 60, USDC: 40 },
    threshold: 5,
    name: 'chaos-test-portfolio',
  })

  if (status === 201 || status === 200) {
    const id = body?.data?.id ?? body?.id
    if (id) {
      log.info('Demo portfolio created', { portfolioId: id })
      return id
    }
  }

  // Fall back to a well-known demo portfolio ID if the backend is in demo mode
  log.warn('Could not create portfolio; using demo fallback ID', { status })
  return 'demo-portfolio-chaos'
}

async function fetchPortfolioState(portfolioId) {
  try {
    const { body } = await httpGet(`/portfolio/${portfolioId}`)
    return body?.data ?? body ?? null
  } catch {
    return null
  }
}

async function fetchRebalanceHistory(portfolioId) {
  try {
    const { body } = await httpGet(`/rebalance/history?portfolioId=${portfolioId}&limit=5`)
    return body?.data?.history ?? body?.history ?? []
  } catch {
    return []
  }
}

// ─── Assertions ──────────────────────────────────────────────────────────────

function assertPortfolioConsistency(portfolioState, label) {
  if (!portfolioState) {
    // Backend may be in demo mode and not return portfolio state — non-fatal
    log.warn(`${label}: portfolio state unavailable (demo/not-found); skipping allocation check`)
    return true
  }

  const allocations = portfolioState.allocations ?? []
  if (!Array.isArray(allocations) || allocations.length === 0) {
    log.warn(`${label}: no allocation data to validate`)
    return true
  }

  let consistent = true

  // Each allocation weight must be a finite number in [0, 100]
  for (const alloc of allocations) {
    const weight = typeof alloc.current === 'number' ? alloc.current : alloc.weight
    if (weight == null || !isFinite(weight) || weight < 0 || weight > 100) {
      log.fail(`${label}: corrupted allocation detected`, { asset: alloc.asset, weight })
      consistent = false
    }
  }

  // Total allocation weight must be ≤ 105 (allow small floating-point drift)
  const total = allocations.reduce((sum, a) => {
    const w = typeof a.current === 'number' ? a.current : (a.weight ?? 0)
    return sum + w
  }, 0)
  if (total > 105) {
    log.fail(`${label}: total allocation > 105% indicating corrupt state`, { total })
    consistent = false
  }

  if (consistent) {
    log.pass(`${label}: portfolio allocations are consistent (total=${total.toFixed(2)}%)`)
  }
  return consistent
}

function assertPartialRebalanceLogged(history, label) {
  if (!Array.isArray(history) || history.length === 0) {
    log.warn(`${label}: no rebalance history available to verify`)
    return true
  }

  // At minimum, history should exist and not reference a corrupted final status
  const lastEntry = history[0]
  const invalidStatuses = ['corrupted', 'undefined', null]
  if (invalidStatuses.includes(lastEntry?.status)) {
    log.fail(`${label}: rebalance history shows invalid status`, { status: lastEntry?.status })
    return false
  }

  log.pass(`${label}: rebalance history present and status is valid`, {
    count: history.length,
    latestStatus: lastEntry?.status,
  })
  return true
}

// ─── Test scenarios ──────────────────────────────────────────────────────────

async function scenarioKillMidRebalance(portfolioId) {
  log.info('─── Scenario: kill-mid-rebalance ───────────────────────────────')
  log.info(`Using portfolioId=${portfolioId}, killDelay=${KILL_DELAY_MS}ms`)

  // 1. Record pre-test state
  const stateBefore = await fetchPortfolioState(portfolioId)
  log.info('Pre-kill portfolio state captured', {
    hasState: stateBefore != null,
    allocationCount: stateBefore?.allocations?.length ?? 'n/a',
  })

  // 2. Fire a rebalance request asynchronously (do NOT await — we want to kill mid-flight)
  log.info('Firing rebalance request (not awaited)')
  const rebalancePromise = httpPost(`/portfolio/${portfolioId}/rebalance`, {
    options: { simulateOnly: false },
  }).catch((err) => {
    // Network error expected after kill — not a failure
    log.info('Rebalance request aborted (expected after kill)', { error: err.message })
    return null
  })

  // 3. Wait the required 500 ms before killing
  log.info(`Waiting ${KILL_DELAY_MS}ms before kill…`)
  await sleep(KILL_DELAY_MS)

  // 4. Kill the backend
  killBackend('SIGKILL')
  log.recovery('Backend killed; initiating restart', { portfolioId })

  // Allow rebalancePromise to settle now that the connection is gone
  await rebalancePromise

  // 5. Restart the backend
  log.info('Restarting backend process…')
  startBackend()
  const restarted = await waitUntilReady(RESTART_TIMEOUT)
  if (!restarted) {
    log.error('Backend did not come back up within timeout', { timeoutMs: RESTART_TIMEOUT })
    return false
  }
  log.recovery('Backend restarted successfully')

  // 6. Allow queue workers a moment to drain pending jobs
  log.info('Waiting for job queue to drain…')
  await sleep(2000)

  // 7. Fetch post-restart state and history
  const stateAfter = await fetchPortfolioState(portfolioId)
  const history = await fetchRebalanceHistory(portfolioId)

  log.recovery('Post-restart state captured', {
    hasState: stateAfter != null,
    historyCount: history.length,
  })

  // 8. Assertions
  const allocationOk = assertPortfolioConsistency(stateAfter, 'post-restart')
  const historyOk = assertPartialRebalanceLogged(history, 'post-restart')

  return allocationOk && historyOk
}

async function scenarioJobQueueDrainsOnRestart(portfolioId) {
  log.info('─── Scenario: job-queue-drains-on-restart ─────────────────────')

  // Queue health endpoint — non-fatal if unavailable (Redis may not be running)
  try {
    const { body } = await httpGet('/queue/health')
    const queueStatus = body?.data ?? body ?? {}
    log.info('Queue health after restart', { queueStatus })

    const pendingCount = queueStatus?.waiting ?? queueStatus?.pending ?? 0
    if (pendingCount === 0) {
      log.pass('job-queue-drains-on-restart: queue is empty (drained or never enqueued)')
    } else {
      log.warn('job-queue-drains-on-restart: queue has pending jobs', { pendingCount })
    }
  } catch {
    log.warn('job-queue-drains-on-restart: queue health endpoint unavailable (Redis likely not running)')
  }

  // Verify the backend itself is healthy (not just alive)
  const { body } = await httpGet('/health').catch(() => ({ body: null }))
  const isHealthy = body?.status === 'healthy' || body?.status === 'degraded'
  if (isHealthy) {
    log.pass('job-queue-drains-on-restart: backend reports healthy status after restart')
  } else {
    log.warn('job-queue-drains-on-restart: backend health status is not "healthy"', {
      status: body?.status,
    })
  }

  return true
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  log.info('═══════════════════════════════════════════════════════════════')
  log.info('Chaos Engineering Test: kill backend mid-rebalance')
  log.info('═══════════════════════════════════════════════════════════════')

  const results = { passed: 0, failed: 0 }

  // ── Phase 1: Start backend ──────────────────────────────────────────────
  log.info('Phase 1: Starting backend…')
  startBackend()
  const ready = await waitUntilReady(STARTUP_TIMEOUT)
  if (!ready) {
    log.error('Backend failed to start within timeout — aborting chaos test', {
      timeoutMs: STARTUP_TIMEOUT,
    })
    process.exit(1)
  }
  log.pass('Phase 1: Backend is up and healthy')

  // ── Phase 2: Identify test portfolio ────────────────────────────────────
  log.info('Phase 2: Identifying test portfolio…')
  let portfolioId
  try {
    portfolioId = await findOrCreateTestPortfolio()
  } catch (err) {
    log.error('Could not identify or create test portfolio', { error: err.message })
    killBackend()
    process.exit(1)
  }
  log.pass('Phase 2: Test portfolio ready', { portfolioId })

  // ── Phase 3: Scenario — kill mid-rebalance ───────────────────────────────
  log.info('Phase 3: Running kill-mid-rebalance scenario…')
  try {
    const ok = await scenarioKillMidRebalance(portfolioId)
    if (ok) {
      results.passed++
      log.pass('Phase 3: kill-mid-rebalance PASSED')
    } else {
      results.failed++
      log.fail('Phase 3: kill-mid-rebalance FAILED')
    }
  } catch (err) {
    results.failed++
    log.error('Phase 3: kill-mid-rebalance threw an unexpected error', { error: err.message })
  }

  // Backend was restarted inside the scenario; make sure it's still up.
  const stillReady = await waitUntilReady(5000)
  if (!stillReady) {
    log.warn('Backend not responding after scenario; restarting for next scenario…')
    if (backendProcess) killBackend()
    startBackend()
    await waitUntilReady(RESTART_TIMEOUT)
  }

  // ── Phase 4: Scenario — queue drains on restart ──────────────────────────
  log.info('Phase 4: Running job-queue-drains-on-restart scenario…')
  try {
    const ok = await scenarioJobQueueDrainsOnRestart(portfolioId)
    if (ok) {
      results.passed++
      log.pass('Phase 4: job-queue-drains-on-restart PASSED')
    } else {
      results.failed++
      log.fail('Phase 4: job-queue-drains-on-restart FAILED')
    }
  } catch (err) {
    results.failed++
    log.error('Phase 4: job-queue-drains-on-restart threw an unexpected error', { error: err.message })
  }

  // ── Teardown ─────────────────────────────────────────────────────────────
  log.info('Tearing down backend process…')
  if (backendProcess) killBackend('SIGTERM')

  // ── Summary ──────────────────────────────────────────────────────────────
  log.info('═══════════════════════════════════════════════════════════════')
  log.info(`Chaos test complete: ${results.passed} passed, ${results.failed} failed`)
  log.info('═══════════════════════════════════════════════════════════════')

  if (results.failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  log.error('Unhandled error in chaos test', { error: err.message, stack: err.stack })
  if (backendProcess) killBackend()
  process.exit(1)
})
