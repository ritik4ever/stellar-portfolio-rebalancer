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
 *   CHAOS_STARTUP_TIMEOUT  - Max ms to wait for backend ready (default: 30000)
 *   CHAOS_RESTART_TIMEOUT  - Max ms to wait for backend restart (default: 30000)
 *   CHAOS_PORTFOLIO_ID     - Portfolio ID to use (default: auto-detected or demo)
 *   CHAOS_VERBOSE          - Stream backend stdout/stderr when set
 */

import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..', '..')
const BACKEND_DIR = resolve(ROOT_DIR, 'backend')

const BACKEND_PORT = parseInt(process.env.CHAOS_BACKEND_PORT || '3001', 10)
const KILL_DELAY_MS = parseInt(process.env.CHAOS_KILL_DELAY_MS || '500', 10)
const STARTUP_TIMEOUT = parseInt(process.env.CHAOS_STARTUP_TIMEOUT || '30000', 10)
const RESTART_TIMEOUT = parseInt(process.env.CHAOS_RESTART_TIMEOUT || '30000', 10)
const BASE_URL = 'http://localhost:' + BACKEND_PORT + '/api'
const REQUEST_TIMEOUT_MS = parseInt(process.env.CHAOS_REQUEST_TIMEOUT_MS || '5000', 10)

// ─── Logging ─────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString()
}

const log = {
  info: function(msg, data) {
    var extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS][' + ts() + '] INFO  ' + msg + extra)
  },
  warn: function(msg, data) {
    var extra = data ? ' ' + JSON.stringify(data) : ''
    console.warn('[CHAOS][' + ts() + '] WARN  ' + msg + extra)
  },
  error: function(msg, data) {
    var extra = data ? ' ' + JSON.stringify(data) : ''
    console.error('[CHAOS][' + ts() + '] ERROR ' + msg + extra)
  },
  recovery: function(msg, data) {
    var extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS][' + ts() + '] RECOVERY ' + msg + extra)
  },
  pass: function(msg, data) {
    var extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS][' + ts() + '] PASS  ' + msg + extra)
  },
  fail: function(msg, data) {
    var extra = data ? ' ' + JSON.stringify(data) : ''
    console.error('[CHAOS][' + ts() + '] FAIL  ' + msg + extra)
  },
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchJson(path, options) {
  options = options || {}
  const controller = new AbortController()
  const timeout = setTimeout(function() { controller.abort() }, REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(BASE_URL + path, Object.assign({}, options, { signal: controller.signal }))
    const body = await res.json().catch(function() { return null })
    return { status: res.status, ok: res.ok, body: body }
  } finally {
    clearTimeout(timeout)
  }
}

async function httpGet(path) {
  return fetchJson(path)
}

async function httpPost(path, payload) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
}

// ─── Backend process management ───────────────────────────────────────────────

var backendProcess = null

function ensureBackendDependencies() {
  const nodeModules = resolve(BACKEND_DIR, 'node_modules')
  if (!existsSync(nodeModules)) {
    log.error(
      'Backend node_modules not found. Run `npm run install:backend` first.',
      { path: nodeModules }
    )
    process.exit(1)
  }
}

/**
 * Returns the PID of any process currently listening on BACKEND_PORT, or null.
 * Uses lsof which is available on Linux/macOS.
 */
function findPortPid() {
  try {
    const result = spawnSync('lsof', ['-ti', ':' + BACKEND_PORT], { encoding: 'utf8' })
    const raw = (result.stdout || '').trim()
    if (raw) {
      const pid = parseInt(raw.split('\n')[0], 10)
      if (!isNaN(pid)) return pid
    }
  } catch (_) {}
  return null
}

/**
 * Kill whatever is listening on BACKEND_PORT by PID.
 * Returns the killed PID or null.
 */
function killPortProcess(signal) {
  signal = signal || 'SIGKILL'
  const pid = findPortPid()
  if (!pid) {
    log.warn('No process found on port ' + BACKEND_PORT + ' to kill')
    return null
  }
  log.info('Sending ' + signal + ' to PID ' + pid + ' on port ' + BACKEND_PORT)
  try {
    process.kill(pid, signal)
  } catch (err) {
    log.warn('Kill signal failed', { pid: pid, error: err.message })
  }
  return pid
}

function buildBackendEnv() {
  // Merge process env with minimum required vars so the backend starts without a .env file
  return Object.assign({}, process.env, {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: String(BACKEND_PORT),
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    LOG_PRETTY: 'false',
    DEMO_MODE: process.env.DEMO_MODE || 'true',
    STELLAR_HORIZON_URL:
      process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    STELLAR_CONTRACT_ADDRESS:
      process.env.STELLAR_CONTRACT_ADDRESS ||
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    STELLAR_REBALANCE_SECRET:
      process.env.STELLAR_REBALANCE_SECRET ||
      'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    DB_PATH: process.env.DB_PATH || './data/portfolio.db',
  })
}

function spawnBackend() {
  ensureBackendDependencies()
  log.info('Spawning backend', { dir: BACKEND_DIR, port: BACKEND_PORT })

  const proc = spawn('npm', ['run', 'dev'], {
    cwd: BACKEND_DIR,
    env: buildBackendEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // put in its own process group so we can kill the group
  })

  proc.stdout.on('data', function(d) {
    if (process.env.CHAOS_VERBOSE) process.stdout.write('[backend] ' + d)
  })
  proc.stderr.on('data', function(d) {
    if (process.env.CHAOS_VERBOSE) process.stderr.write('[backend] ' + d)
  })
  proc.on('error', function(err) {
    log.error('Backend spawn error', { error: err.message })
  })

  backendProcess = proc
  return proc
}

function killManagedBackend(signal) {
  signal = signal || 'SIGKILL'
  if (backendProcess && backendProcess.exitCode === null) {
    const pid = backendProcess.pid
    log.info('Killing managed backend process group', { pid: pid, signal: signal })
    try {
      process.kill(-pid, signal) // negative pid targets the process group
    } catch (_) {
      try { backendProcess.kill(signal) } catch (_2) {}
    }
  }
  backendProcess = null
}

async function waitUntilReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await httpGet('/health')
      const s = result.body && result.body.status
      if (result.status === 200 && (s === 'healthy' || s === 'degraded')) {
        log.info('Backend ready', { status: s })
        return true
      }
    } catch (_) {
      // not up yet
    }
    await sleep(300)
  }
  return false
}

async function isBackendAlreadyRunning() {
  try {
    const result = await httpGet('/health')
    return result.status === 200
  } catch (_) {
    return false
  }
}

// ─── Portfolio helpers ────────────────────────────────────────────────────────

async function findOrCreateTestPortfolio() {
  if (process.env.CHAOS_PORTFOLIO_ID) {
    log.info('Using provided portfolio ID', { portfolioId: process.env.CHAOS_PORTFOLIO_ID })
    return process.env.CHAOS_PORTFOLIO_ID
  }

  // Try to find an existing portfolio
  try {
    const result = await httpGet('/portfolios?limit=1')
    const portfolios =
      (result.body && result.body.data && result.body.data.portfolios) ||
      (result.body && result.body.portfolios) ||
      []
    if (portfolios.length > 0 && portfolios[0].id) {
      log.info('Using existing portfolio', { portfolioId: portfolios[0].id })
      return portfolios[0].id
    }
  } catch (_) {}

  // Create a minimal demo portfolio
  log.info('Creating demo portfolio for chaos test')
  const result = await httpPost('/portfolio', {
    userAddress: 'GCHAOS0000000000000000000000000000000000000000000000000000',
    allocations: { XLM: 60, USDC: 40 },
    threshold: 5,
    name: 'chaos-test-portfolio',
  })

  if ((result.status === 201 || result.status === 200) && result.body) {
    const id = (result.body.data && result.body.data.id) || result.body.id
    if (id) {
      log.info('Demo portfolio created', { portfolioId: id })
      return id
    }
  }

  // Verify whether the well-known demo fallback exists before trusting it
  const fallbackId = 'demo-portfolio-chaos'
  const check = await httpGet('/portfolio/' + fallbackId).catch(function() { return { ok: false } })
  if (check.ok) {
    log.info('Using verified demo fallback portfolio', { portfolioId: fallbackId })
    return fallbackId
  }
  throw new Error('Could not create or verify a test portfolio (status=' + result.status + ')')
}

async function fetchPortfolioState(portfolioId) {
  try {
    const result = await httpGet('/portfolio/' + portfolioId)
    return (result.body && result.body.data) || result.body || null
  } catch (_) {
    return null
  }
}

async function fetchRebalanceHistory(portfolioId) {
  try {
    const result = await httpGet('/rebalance/history?portfolioId=' + portfolioId + '&limit=5')
    return (
      (result.body && result.body.data && result.body.data.history) ||
      (result.body && result.body.history) ||
      []
    )
  } catch (_) {
    return []
  }
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function assertPortfolioConsistency(portfolioState, label) {
  if (!portfolioState) {
    log.fail(label + ': portfolio state unavailable; cannot verify allocation consistency')
    return false
  }

  const rawAllocations = portfolioState.allocations
  const allocations = Array.isArray(rawAllocations)
    ? rawAllocations
    : rawAllocations && typeof rawAllocations === 'object'
      ? Object.entries(rawAllocations).map(function(entry) { return { asset: entry[0], weight: entry[1] } })
      : []

  if (allocations.length === 0) {
    log.fail(label + ': no allocation data to validate')
    return false
  }

  let consistent = true
  for (var i = 0; i < allocations.length; i++) {
    const alloc = allocations[i]
    const weight = typeof alloc.current === 'number' ? alloc.current : alloc.weight
    if (weight == null || !isFinite(weight) || weight < 0 || weight > 100) {
      log.fail(label + ': corrupted allocation detected for ' + alloc.asset + ' weight=' + weight)
      consistent = false
    }
  }

  const total = allocations.reduce(function(sum, a) {
    return sum + (typeof a.current === 'number' ? a.current : (a.weight || 0))
  }, 0)
  if (total > 105) {
    log.fail(label + ': total allocation ' + total.toFixed(2) + '% > 105% — corrupted state')
    consistent = false
  }

  if (consistent) {
    log.pass(label + ': allocations consistent (total=' + total.toFixed(2) + '%)')
  }
  return consistent
}

function assertPartialRebalanceLogged(history, label) {
  if (!Array.isArray(history) || history.length === 0) {
    log.fail(label + ': no rebalance history found — expected a record of the interrupted rebalance')
    return false
  }

  const last = history[0]
  const invalidStatuses = ['corrupted', 'undefined']
  if (invalidStatuses.indexOf(last && last.status) !== -1 || last.status === null) {
    log.fail(label + ': rebalance history has invalid status: ' + last.status)
    return false
  }

  // Require the most recent entry to reflect that a rebalance actually ran (even if interrupted)
  const recoveryStatuses = ['partial', 'interrupted', 'recovered', 'failed', 'pending', 'completed']
  if (recoveryStatuses.indexOf(last.status) === -1) {
    log.fail(label + ': rebalance status does not reflect recovery behavior', { status: last.status })
    return false
  }

  log.pass(label + ': rebalance history valid (count=' + history.length + ', status=' + last.status + ')')
  return true
}

// ─── Test scenarios ───────────────────────────────────────────────────────────

async function scenarioKillMidRebalance(portfolioId) {
  log.info('Scenario: kill-mid-rebalance — portfolioId=' + portfolioId + ' killDelay=' + KILL_DELAY_MS + 'ms')

  const stateBefore = await fetchPortfolioState(portfolioId)
  log.info('Pre-kill state captured', {
    hasState: stateBefore != null,
    allocations: stateBefore && stateBefore.allocations ? stateBefore.allocations.length : 'n/a',
  })

  // Fire rebalance WITHOUT awaiting — we want it in-flight when we kill
  log.info('Firing rebalance request (not awaited)')
  const rebalancePromise = httpPost('/portfolio/' + portfolioId + '/rebalance', {
    options: { simulateOnly: false },
  }).catch(function(err) {
    log.info('Rebalance connection dropped (expected after kill)', { error: err.message })
    return null
  })

  log.info('Waiting ' + KILL_DELAY_MS + 'ms before kill')
  await sleep(KILL_DELAY_MS)

  // Kill — prefer managed process group kill; fall back to port-based kill
  if (backendProcess && backendProcess.exitCode === null) {
    killManagedBackend('SIGKILL')
  } else {
    killPortProcess('SIGKILL')
  }
  log.recovery('Backend killed', { portfolioId: portfolioId })

  await rebalancePromise

  // Wait a moment for the port to be freed before restarting
  await sleep(500)

  log.info('Restarting backend…')
  spawnBackend()
  const restarted = await waitUntilReady(RESTART_TIMEOUT)
  if (!restarted) {
    log.error('Backend did not restart within timeout', { timeoutMs: RESTART_TIMEOUT })
    return false
  }
  log.recovery('Backend restarted successfully')

  // Let queue workers drain any surviving jobs
  log.info('Waiting 2s for job queue to drain…')
  await sleep(2000)

  const stateAfter = await fetchPortfolioState(portfolioId)
  const history = await fetchRebalanceHistory(portfolioId)

  log.recovery('Post-restart state captured', {
    hasState: stateAfter != null,
    historyCount: history.length,
  })

  const allocationOk = assertPortfolioConsistency(stateAfter, 'post-restart')
  const historyOk = assertPartialRebalanceLogged(history, 'post-restart')
  return allocationOk && historyOk
}

async function scenarioJobQueueDrainsOnRestart(portfolioId) {
  log.info('Scenario: job-queue-drains-on-restart')

  var ok = true

  // Queue health check — non-fatal when Redis is not running (endpoint may not exist)
  try {
    const queueResult = await httpGet('/queue/health')
    if (!queueResult.ok) {
      log.warn('job-queue-drains-on-restart: queue health endpoint unavailable', { status: queueResult.status })
    } else {
      const queueStatus = (queueResult.body && queueResult.body.data) || queueResult.body || {}
      const pending = queueStatus.waiting || queueStatus.pending || 0
      if (pending === 0) {
        log.pass('job-queue-drains-on-restart: queue empty (drained or not used)')
      } else {
        log.fail('job-queue-drains-on-restart: ' + pending + ' pending jobs remain after restart', { pending: pending })
        ok = false
      }
    }
  } catch (_) {
    log.warn('job-queue-drains-on-restart: queue health endpoint unavailable (Redis may not be running)')
  }

  const healthResult = await httpGet('/health').catch(function() { return { body: null } })
  const status = healthResult.body && healthResult.body.status
  if (status === 'healthy' || status === 'degraded') {
    log.pass('job-queue-drains-on-restart: backend healthy after restart (status=' + status + ')')
  } else {
    log.fail('job-queue-drains-on-restart: backend health status is not acceptable', { status: status })
    ok = false
  }

  return ok
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  log.info('═══════════════════════════════════════════════════════════════')
  log.info('Chaos Engineering Test: kill backend mid-rebalance')
  log.info('═══════════════════════════════════════════════════════════════')

  const results = { passed: 0, failed: 0 }

  // Phase 1: Ensure backend is running ────────────────────────────────────────
  log.info('Phase 1: Ensuring backend is running…')
  const alreadyUp = await isBackendAlreadyRunning()
  if (alreadyUp) {
    log.info('Backend already running on port ' + BACKEND_PORT + ' — will use it')
  } else {
    log.info('No backend detected — spawning one…')
    spawnBackend()
    const ready = await waitUntilReady(STARTUP_TIMEOUT)
    if (!ready) {
      log.error(
        'Backend failed to start within timeout. ' +
        'Ensure `cd backend && npm install` has been run and the backend can start, ' +
        'or start it manually and re-run the chaos test.',
        { timeoutMs: STARTUP_TIMEOUT }
      )
      if (backendProcess) killManagedBackend()
      process.exit(1)
    }
  }
  log.pass('Phase 1: Backend is up')

  // Phase 2: Identify test portfolio ──────────────────────────────────────────
  log.info('Phase 2: Identifying test portfolio…')
  let portfolioId
  try {
    portfolioId = await findOrCreateTestPortfolio()
  } catch (err) {
    log.error('Could not identify or create test portfolio', { error: err.message })
    if (backendProcess) killManagedBackend()
    process.exit(1)
  }
  log.pass('Phase 2: Test portfolio ready — id=' + portfolioId)

  // Phase 3: Kill mid-rebalance ────────────────────────────────────────────────
  log.info('Phase 3: kill-mid-rebalance scenario…')
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
    log.error('Phase 3: unexpected error', { error: err.message })
  }

  // Ensure backend is still up for next scenario
  const stillUp = await isBackendAlreadyRunning()
  if (!stillUp) {
    log.warn('Backend not responding after kill scenario — restarting…')
    if (backendProcess) killManagedBackend()
    spawnBackend()
    await waitUntilReady(RESTART_TIMEOUT)
  }

  // Phase 4: Job queue drains on restart ──────────────────────────────────────
  log.info('Phase 4: job-queue-drains-on-restart scenario…')
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
    log.error('Phase 4: unexpected error', { error: err.message })
  }

  // Teardown ───────────────────────────────────────────────────────────────────
  log.info('Teardown: stopping managed backend process…')
  if (backendProcess) killManagedBackend('SIGTERM')

  log.info('═══════════════════════════════════════════════════════════════')
  log.info('Chaos test complete: ' + results.passed + ' passed, ' + results.failed + ' failed')
  log.info('═══════════════════════════════════════════════════════════════')

  if (results.failed > 0) {
    process.exit(1)
  }
}

main().catch(function(err) {
  log.error('Unhandled error in chaos test', { error: err.message })
  if (backendProcess) killManagedBackend()
  process.exit(1)
})
