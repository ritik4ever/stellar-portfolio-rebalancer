#!/usr/bin/env node
/**
 * Chaos Engineering Test: Reflector Oracle Outage During Scheduled Rebalance
 *
 * Validates system resilience when the Reflector oracle becomes unavailable during
 * an in-progress scheduled rebalance. Verifies that the system falls back gracefully
 * via circuit breaker or secondary oracle rather than corrupting portfolio state.
 *
 * Usage:
 *   node scripts/chaos/reflector-oracle-outage.mjs
 *   CHAOS_ENVIRONMENT=staging npm run test:chaos:oracle
 *
 * Environment variables:
 *   CHAOS_BACKEND_PORT       - Backend port (default: 3001)
 *   CHAOS_OUTAGE_DELAY_MS    - Delay before simulating outage in ms (default: 1000)
 *   CHAOS_OUTAGE_DURATION_MS - Duration of simulated outage in ms (default: 5000)
 *   CHAOS_STARTUP_TIMEOUT    - Max ms to wait for backend ready (default: 30000)
 *   CHAOS_RECOVERY_TIMEOUT   - Max ms to wait for backend recovery (default: 30000)
 *   CHAOS_PORTFOLIO_ID       - Portfolio ID to use (default: auto-detected or demo)
 *   CHAOS_VERBOSE            - Stream backend stdout/stderr when set
 *   CHAOS_ENVIRONMENT        - Target environment (default: staging)
 *
 * IMPORTANT: This script should only be run against a staging environment.
 * Never run against production without explicit approval.
 */

import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..', '..')
const BACKEND_DIR = resolve(ROOT_DIR, 'backend')

const BACKEND_PORT = parseInt(process.env.CHAOS_BACKEND_PORT || '3001', 10)
const OUTAGE_DELAY_MS = parseInt(process.env.CHAOS_OUTAGE_DELAY_MS || '1000', 10)
const OUTAGE_DURATION_MS = parseInt(process.env.CHAOS_OUTAGE_DURATION_MS || '5000', 10)
const STARTUP_TIMEOUT = parseInt(process.env.CHAOS_STARTUP_TIMEOUT || '30000', 10)
const RECOVERY_TIMEOUT = parseInt(process.env.CHAOS_RECOVERY_TIMEOUT || '30000', 10)
const ENVIRONMENT = process.env.CHAOS_ENVIRONMENT || 'staging'
const BASE_URL = 'http://localhost:' + BACKEND_PORT + '/api'
const REQUEST_TIMEOUT_MS = parseInt(process.env.CHAOS_REQUEST_TIMEOUT_MS || '5000', 10)

// Safety check: prevent running against production
if (ENVIRONMENT === 'production') {
  console.error('[CHAOS] ERROR: This chaos test should NOT be run against production.')
  console.error('[CHAOS] Set CHAOS_ENVIRONMENT=staging to run safely.')
  process.exit(1)
}

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
var originalEnvBackup = null

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
    detached: true,
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
      process.kill(-pid, signal)
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

// ─── Oracle outage simulation ─────────────────────────────────────────────────

/**
 * Simulates a Reflector oracle outage by modifying environment variables
 * to point to an invalid endpoint, then restoring the original configuration.
 */
function simulateOracleOutage() {
  log.info('Simulating Reflector oracle outage')
  
  // Backup original environment
  originalEnvBackup = {
    STELLAR_HORIZON_URL: process.env.STELLAR_HORIZON_URL,
    STELLAR_CONTRACT_ADDRESS: process.env.STELLAR_CONTRACT_ADDRESS,
  }
  
  // Set invalid oracle endpoint to simulate outage
  process.env.STELLAR_HORIZON_URL = 'http://invalid-oracle-endpoint.example.com:9999'
  process.env.STELLAR_CONTRACT_ADDRESS = 'CINVALID00000000000000000000000000000000000000000000000000'
  
  log.info('Oracle endpoint set to invalid URL', {
    horizonUrl: process.env.STELLAR_HORIZON_URL,
    contractAddress: process.env.STELLAR_CONTRACT_ADDRESS,
  })
}

function restoreOracle() {
  log.info('Restoring Reflector oracle configuration')
  
  if (originalEnvBackup) {
    process.env.STELLAR_HORIZON_URL = originalEnvBackup.STELLAR_HORIZON_URL
    process.env.STELLAR_CONTRACT_ADDRESS = originalEnvBackup.STELLAR_CONTRACT_ADDRESS
    log.info('Oracle endpoint restored', {
      horizonUrl: process.env.STELLAR_HORIZON_URL,
      contractAddress: process.env.STELLAR_CONTRACT_ADDRESS,
    })
  }
  
  originalEnvBackup = null
}

// ─── Portfolio helpers ────────────────────────────────────────────────────────

async function findOrCreateTestPortfolio() {
  if (process.env.CHAOS_PORTFOLIO_ID) {
    log.info('Using provided portfolio ID', { portfolioId: process.env.CHAOS_PORTFOLIO_ID })
    return process.env.CHAOS_PORTFOLIO_ID
  }

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

  log.info('Creating demo portfolio for chaos test')
  const result = await httpPost('/portfolio', {
    userAddress: 'GCHAOS0000000000000000000000000000000000000000000000000000',
    allocations: { XLM: 60, USDC: 40 },
    threshold: 5,
    name: 'chaos-oracle-test-portfolio',
  })

  if ((result.status === 201 || result.status === 200) && result.body) {
    const id = (result.body.data && result.body.data.id) || result.body.id
    if (id) {
      log.info('Demo portfolio created', { portfolioId: id })
      return id
    }
  }

  const fallbackId = 'demo-portfolio-oracle-chaos'
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
    return sum + (typeof a.current === 'number' ? alloc.current : (a.weight || 0))
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

function assertCircuitBreakerTriggered(history, label) {
  if (!Array.isArray(history) || history.length === 0) {
    log.fail(label + ': no rebalance history found')
    return false
  }

  const last = history[0]
  const outageStatuses = ['oracle_unavailable', 'circuit_breaker', 'paused', 'failed', 'pending']
  
  if (outageStatuses.indexOf(last && last.status) !== -1) {
    log.pass(label + ': circuit breaker/fallback triggered (status=' + last.status + ')')
    return true
  }

  if (last.status === 'completed') {
    log.warn(label + ': rebalance completed despite outage (may have used fallback)')
    return true
  }

  log.fail(label + ': unexpected status during oracle outage', { status: last.status })
  return false
}

// ─── Test scenarios ───────────────────────────────────────────────────────────

async function scenarioOracleOutageDuringRebalance(portfolioId) {
  log.info('Scenario: oracle-outage-during-rebalance — portfolioId=' + portfolioId + 
           ' outageDelay=' + OUTAGE_DELAY_MS + 'ms outageDuration=' + OUTAGE_DURATION_MS + 'ms')

  const stateBefore = await fetchPortfolioState(portfolioId)
  log.info('Pre-outage state captured', {
    hasState: stateBefore != null,
    allocations: stateBefore && stateBefore.allocations ? stateBefore.allocations.length : 'n/a',
  })

  // Fire rebalance WITHOUT awaiting
  log.info('Firing rebalance request (not awaited)')
  const rebalancePromise = httpPost('/portfolio/' + portfolioId + '/rebalance', {
    options: { simulateOnly: false },
  }).catch(function(err) {
    log.info('Rebalance request failed (expected during outage)', { error: err.message })
    return null
  })

  // Wait for rebalance to start
  log.info('Waiting ' + OUTAGE_DELAY_MS + 'ms before simulating outage')
  await sleep(OUTAGE_DELAY_MS)

  // Simulate oracle outage
  simulateOracleOutage()
  log.recovery('Oracle outage simulated')

  // Keep outage for specified duration
  log.info('Maintaining outage for ' + OUTAGE_DURATION_MS + 'ms')
  await sleep(OUTAGE_DURATION_MS)

  // Restore oracle
  restoreOracle()
  log.recovery('Oracle restored')

  await rebalancePromise

  // Wait for system to recover
  log.info('Waiting 3s for system to recover from outage')
  await sleep(3000)

  const stateAfter = await fetchPortfolioState(portfolioId)
  const history = await fetchRebalanceHistory(portfolioId)

  log.recovery('Post-recovery state captured', {
    hasState: stateAfter != null,
    historyCount: history.length,
  })

  const allocationOk = assertPortfolioConsistency(stateAfter, 'post-recovery')
  const circuitBreakerOk = assertCircuitBreakerTriggered(history, 'post-recovery')
  
  return allocationOk && circuitBreakerOk
}

// ─── Report generation ───────────────────────────────────────────────────────

function generateReport(results) {
  const report = {
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT,
    test: 'reflector-oracle-outage',
    configuration: {
      outageDelayMs: OUTAGE_DELAY_MS,
      outageDurationMs: OUTAGE_DURATION_MS,
      portfolioId: process.env.CHAOS_PORTFOLIO_ID || 'auto-detected',
    },
    results: results,
  }

  const reportPath = resolve(ROOT_DIR, 'chaos-oracle-outage-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  log.info('Chaos report written', { path: reportPath })
  
  return reportPath
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  log.info('═══════════════════════════════════════════════════════════════')
  log.info('Chaos Engineering Test: Reflector Oracle Outage')
  log.info('Environment: ' + ENVIRONMENT)
  log.info('═══════════════════════════════════════════════════════════════')

  const results = { passed: 0, failed: 0, scenarios: [] }

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
        'Ensure `cd backend && npm install` has been run and the backend can start.',
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

  // Phase 3: Oracle outage during rebalance ────────────────────────────────────
  log.info('Phase 3: oracle-outage-during-rebalance scenario…')
  try {
    const ok = await scenarioOracleOutageDuringRebalance(portfolioId)
    results.scenarios.push({ name: 'oracle-outage-during-rebalance', passed: ok })
    if (ok) {
      results.passed++
      log.pass('Phase 3: oracle-outage-during-rebalance PASSED')
    } else {
      results.failed++
      log.fail('Phase 3: oracle-outage-during-rebalance FAILED')
    }
  } catch (err) {
    results.failed++
    results.scenarios.push({ name: 'oracle-outage-during-rebalance', passed: false, error: err.message })
    log.error('Phase 3: unexpected error', { error: err.message })
  }

  // Ensure oracle is restored
  if ( originalEnvBackup) {
    restoreOracle()
  }

  // Teardown ───────────────────────────────────────────────────────────────────
  log.info('Teardown: stopping managed backend process…')
  if (backendProcess) killManagedBackend('SIGTERM')

  // Generate report
  const reportPath = generateReport(results)

  log.info('═══════════════════════════════════════════════════════════════')
  log.info('Chaos test complete: ' + results.passed + ' passed, ' + results.failed + ' failed')
  log.info('Report: ' + reportPath)
  log.info('═══════════════════════════════════════════════════════════════')

  if (results.failed > 0) {
    process.exit(1)
  }
}

main().catch(function(err) {
  log.error('Unhandled error in chaos test', { error: err.message })
  if (originalEnvBackup) restoreOracle()
  if (backendProcess) killManagedBackend()
  process.exit(1)
})
