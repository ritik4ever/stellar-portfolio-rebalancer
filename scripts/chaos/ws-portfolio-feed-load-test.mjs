#!/usr/bin/env node
/**
 * Chaos Engineering / Load Test: WebSocket portfolioFeed under concurrent load
 *
 * Simulates a configurable number of concurrent WebSocket subscriptions to
 * the portfolio feed endpoint (/ws/portfolio/:id). Measures connection
 * acceptance latency, message delivery latency, and server resource usage.
 * Identifies the practical concurrent-connection ceiling for capacity planning.
 *
 * Usage:
 *   node scripts/chaos/ws-portfolio-feed-load-test.mjs
 *   npm run test:chaos:ws-load
 *
 * Environment variables:
 *   CHAOS_WS_BACKEND_URL              - Backend base URL (default: http://localhost:3001)
 *   CHAOS_WS_CONCURRENT_CONNECTIONS   - Total connections to simulate (default: 100)
 *   CHAOS_WS_BATCH_SIZE               - Connections per batch (default: 10)
 *   CHAOS_WS_BATCH_DELAY_MS           - Delay between batches in ms (default: 200)
 *   CHAOS_WS_DURATION_MS              - How long to sustain the load in ms (default: 60000)
 *   CHAOS_WS_PORTFOLIO_ID_PREFIX      - Prefix for generated portfolio IDs (default: load-test-pf)
 *   CHAOS_WS_JWT_SECRET               - JWT secret for token generation (default: auto)
 *   CHAOS_WS_AUTH_ENABLED             - Whether auth is required (default: false)
 *   CHAOS_WS_VERBOSE                  - Enable verbose logging when set
 *   CHAOS_WS_TIMEOUT_MS               - Individual connection timeout (default: 10000)
 *   CHAOS_WS_RAMP_STRATEGY            - 'batch' or 'linear' ramp strategy (default: batch)
 *   CHAOS_WS_RESULTS_DIR              - Directory to write results JSON file (default: none)
 */

import { randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

// ─── Dynamic import of ws to avoid issues when module not installed ──────────
let WebSocketImpl
try {
  const wsModule = await import('ws')
  WebSocketImpl = wsModule.default || wsModule.WebSocket || wsModule
} catch (_) {
  console.error('[CHAOS-WS] The "ws" package is required. Run: npm install ws')
  process.exit(1)
}

// Optional: jwt for token generation when auth is enabled
let jwtModule = null
try {
  jwtModule = await import('jsonwebtoken')
} catch (_) {
  // jwt is optional; only needed when CHAOS_WS_AUTH_ENABLED=true
}

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  backendUrl: process.env.CHAOS_WS_BACKEND_URL || 'http://localhost:3001',
  concurrentConnections: parseInt(process.env.CHAOS_WS_CONCURRENT_CONNECTIONS || '100', 10),
  batchSize: parseInt(process.env.CHAOS_WS_BATCH_SIZE || '10', 10),
  batchDelayMs: parseInt(process.env.CHAOS_WS_BATCH_DELAY_MS || '200', 10),
  durationMs: parseInt(process.env.CHAOS_WS_DURATION_MS || '60000', 10),
  portfolioIdPrefix: process.env.CHAOS_WS_PORTFOLIO_ID_PREFIX || 'load-test-pf',
  jwtSecret: process.env.CHAOS_WS_JWT_SECRET || randomBytes(32).toString('hex'),
  authEnabled: process.env.CHAOS_WS_AUTH_ENABLED === 'true',
  verbose: Boolean(process.env.CHAOS_WS_VERBOSE),
  timeoutMs: parseInt(process.env.CHAOS_WS_TIMEOUT_MS || '10000', 10),
  rampStrategy: process.env.CHAOS_WS_RAMP_STRATEGY || 'batch',
}

// Derive WebSocket URL from HTTP backend URL
const httpHost = CONFIG.backendUrl.replace(/^https?:\/\//, '')
const wsBaseUrl = `ws://${httpHost}`

// ─── Logging ─────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString()
}

const log = {
  info: function (msg, data) {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS-WS][' + ts() + '] INFO  ' + msg + extra)
  },
  warn: function (msg, data) {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.warn('[CHAOS-WS][' + ts() + '] WARN  ' + msg + extra)
  },
  error: function (msg, data) {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.error('[CHAOS-WS][' + ts() + '] ERROR ' + msg + extra)
  },
  metric: function (msg, data) {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS-WS][' + ts() + '] METRIC ' + msg + extra)
  },
  pass: function (msg, data) {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS-WS][' + ts() + '] PASS  ' + msg + extra)
  },
  fail: function (msg, data) {
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.error('[CHAOS-WS][' + ts() + '] FAIL  ' + msg + extra)
  },
  verbose: function (msg, data) {
    if (!CONFIG.verbose) return
    const extra = data ? ' ' + JSON.stringify(data) : ''
    console.log('[CHAOS-WS][' + ts() + '] DEBUG ' + msg + extra)
  },
}

// ─── Metrics collection ──────────────────────────────────────────────────────

const latencyMetrics = {
  /** Time from connection attempt to 'open' event, in ms */
  connectionLatencies: [],
  /** Time from CONNECTION_ACK receipt to first PORTFOLIO_VALUE_UPDATE, in ms */
  firstMessageLatencies: [],
  /** All message delivery latencies (server timestamp vs client receipt time) */
  messageDeliveryLatencies: [],
  /** Count of connections that succeeded */
  connectionsSucceeded: 0,
  /** Count of connections that failed */
  connectionsFailed: 0,
  /** Count of messages received across all connections */
  totalMessagesReceived: 0,
  /** Count of connections that dropped unexpectedly during the test */
  connectionsDropped: 0,
}

function buildPercentileReport(arr) {
  if (arr.length === 0) return null
  return {
    p50: percentile(arr, 50),
    p75: percentile(arr, 75),
    p95: percentile(arr, 95),
    p99: percentile(arr, 99),
    max: Math.max(...arr),
    mean: Math.round(mean(arr)),
    min: Math.min(...arr),
    sampleSize: arr.length,
  }
}

function percentile(arr, pct) {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const idx = Math.ceil((pct / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function mean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// ─── Server resource monitoring ──────────────────────────────────────────────

let resourceSamples = []

function sampleResourceUsage() {
  const mem = process.memoryUsage()
  const cpuUsage = process.cpuUsage()
  return {
    timestamp: Date.now(),
    heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
    cpuUser: cpuUsage.user,
    cpuSystem: cpuUsage.system,
  }
}

async function fetchBackendResourceUsage() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(CONFIG.backendUrl + '/metrics', { signal: controller.signal })
    clearTimeout(timeout)
    if (res.ok) {
      const text = await res.text()
      // Parse Prometheus metrics for connection counts and memory
      const result = {}
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('#')) continue
        const m = line.match(/^(\w+)\s+([\d.e+-]+)/)
        if (m) {
          result[m[1]] = parseFloat(m[2])
        }
      }
      return result
    }
  } catch (_) {
    // /metrics might not be available
  }
  return null
}

// ─── Token generation (when auth is enabled) ─────────────────────────────────

function generateTestToken(portfolioId, userId) {
  if (!jwtModule) {
    throw new Error('jsonwebtoken module not available. Install: npm install jsonwebtoken')
  }
  return jwtModule.default.sign(
    { sub: userId, type: 'access' },
    CONFIG.jwtSecret,
    { expiresIn: '1h' },
  )
}

// ─── WebSocket connection helpers ────────────────────────────────────────────

/**
 * Opens a single WebSocket connection to the portfolio feed and tracks metrics.
 * Returns a connection record with the ws instance and collected metrics.
 */
function connectPortfolioFeed(portfolioId, userId, token) {
  return new Promise((resolve, reject) => {
    const connectStart = Date.now()
    const connectTimeout = setTimeout(() => {
      try { ws.close() } catch (_) {}
      reject(new Error('Connection timeout after ' + CONFIG.timeoutMs + 'ms'))
    }, CONFIG.timeoutMs)

    // Build URL with token if auth enabled
    let wsUrl = wsBaseUrl + '/ws/portfolio/' + portfolioId
    if (token) {
      wsUrl += '?token=' + encodeURIComponent(token)
    }

    const ws = new WebSocketImpl(wsUrl)
    let ackReceived = false
    let ackReceivedTime = null

    const record = {
      ws,
      portfolioId,
      userId,
      connectStart,
      connectEnd: null,
      ackTime: null,
      firstMessageTime: null,
      messagesReceived: [],
      state: 'connecting',
    }

    ws.on('open', () => {
      record.connectEnd = Date.now()
      const connectLatency = record.connectEnd - connectStart
      latencyMetrics.connectionLatencies.push(connectLatency)
      latencyMetrics.connectionsSucceeded++
      record.state = 'open'
      log.verbose('Connection opened', { portfolioId, latencyMs: connectLatency })
    })

    ws.on('message', (data) => {
      const now = Date.now()
      let parsed
      try {
        parsed = JSON.parse(data.toString())
      } catch (_) {
        return
      }

      latencyMetrics.totalMessagesReceived++

      if (parsed.type === 'CONNECTION_ACK') {
        ackReceived = true
        ackReceivedTime = now
        record.ackTime = now
        clearTimeout(connectTimeout)
      } else if (parsed.type === 'PORTFOLIO_VALUE_UPDATE') {
        if (!record.firstMessageTime) {
          record.firstMessageTime = now
          const firstMsgLatency = ackReceivedTime ? now - ackReceivedTime : null
          if (firstMsgLatency !== null) {
            latencyMetrics.firstMessageLatencies.push(firstMsgLatency)
          }
        }
        // Message delivery latency: server timestamp vs client receipt
        if (parsed.timestamp) {
          const deliveryLatency = now - parsed.timestamp
          latencyMetrics.messageDeliveryLatencies.push(deliveryLatency)
        }
        record.messagesReceived.push({ time: now, prices: parsed.prices })
      } else if (parsed.type === 'HEARTBEAT') {
        // Track heartbeat latency
        if (parsed.timestamp) {
          record.messagesReceived.push({ time: now, type: 'HEARTBEAT' })
        }
      }
    })

    ws.on('error', (err) => {
      clearTimeout(connectTimeout)
      latencyMetrics.connectionsFailed++
      record.state = 'error'
      const elapsed = Date.now() - connectStart
      log.verbose('Connection error', { portfolioId, error: err.message, elapsedMs: elapsed })
    })

    ws.on('close', (code, reason) => {
      clearTimeout(connectTimeout)
      if (record.state === 'connecting') {
        latencyMetrics.connectionsFailed++
        record.state = 'closed-early'
      } else if (record.state === 'open') {
        latencyMetrics.connectionsDropped++
        record.state = 'dropped'
      }
      log.verbose('Connection closed', {
        portfolioId,
        code,
        reason: reason?.toString().slice(0, 100),
        previousState: record.state,
      })
    })

    // Resolve once we receive CONNECTION_ACK or hit error/timeout
    const checkInterval = setInterval(() => {
      if (ackReceived) {
        clearInterval(checkInterval)
        resolve(record)
      } else if (record.state === 'error' || record.state === 'closed-early') {
        clearInterval(checkInterval)
        reject(new Error('Connection failed before ACK'))
      }
    }, 50)

    // Safety timeout for the promise itself
    setTimeout(() => {
      clearInterval(checkInterval)
      if (!ackReceived) {
        reject(new Error('ACK wait timeout'))
      }
    }, CONFIG.timeoutMs)
  })
}

/**
 * Gracefully close all connections in the records array
 */
function closeAllConnections(records) {
  const openRecords = records.filter(
    (r) => r.ws && (r.ws.readyState === 0 || r.ws.readyState === 1),
  )
  log.info('Closing ' + openRecords.length + ' open connections...')

  for (const record of openRecords) {
    try {
      record.ws.close(1000, 'Load test complete')
    } catch (_) {
      try { record.ws.terminate() } catch (__) {}
    }
  }
}

// ─── Ramp strategies ─────────────────────────────────────────────────────────

/**
 * Batch ramp: open connections in fixed-size batches with delays
 */
async function batchRamp(totalConnections) {
  const records = []
  const batchCount = Math.ceil(totalConnections / CONFIG.batchSize)
  log.info('Batch ramp: ' + totalConnections + ' connections in ' + batchCount + ' batches of ' + CONFIG.batchSize)

  for (let batch = 0; batch < batchCount; batch++) {
    const start = batch * CONFIG.batchSize
    const end = Math.min(start + CONFIG.batchSize, totalConnections)
    const batchSize = end - start

    log.info('Batch ' + (batch + 1) + '/' + batchCount + ': opening ' + batchSize + ' connections (' + start + '-' + (end - 1) + ')')

    const batchPromises = []
    for (let i = start; i < end; i++) {
      const portfolioId = CONFIG.portfolioIdPrefix + '-' + i
      const userId = 'GLOADTEST' + String(i).padStart(20, '0')
      const token = CONFIG.authEnabled ? generateTestToken(portfolioId, userId) : null
      batchPromises.push(connectPortfolioFeed(portfolioId, userId, token))
    }

    const batchResults = await Promise.allSettled(batchPromises)

    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i]
      if (result.status === 'fulfilled') {
        records.push(result.value)
      } else {
        const idx = start + i
        log.verbose('Connection failed for portfolio ' + idx, { error: result.reason?.message })
      }
    }

    const batchOk = batchResults.filter((r) => r.status === 'fulfilled').length
    log.info('Batch ' + (batch + 1) + ' complete: ' + batchOk + '/' + batchSize + ' connected')

    // Report intermediate metrics
    if (latencyMetrics.connectionLatencies.length > 0) {
      log.metric('Connection latency (ms) so far', {
        p50: percentile(latencyMetrics.connectionLatencies, 50),
        p95: percentile(latencyMetrics.connectionLatencies, 95),
        p99: percentile(latencyMetrics.connectionLatencies, 99),
        max: Math.max(...latencyMetrics.connectionLatencies),
        mean: Math.round(mean(latencyMetrics.connectionLatencies)),
        sampleSize: latencyMetrics.connectionLatencies.length,
      })
    }

    if (batch < batchCount - 1) {
      await sleep(CONFIG.batchDelayMs)
    }
  }

  return records
}

/**
 * Linear ramp: open connections one by one with a small delay
 */
async function linearRamp(totalConnections) {
  const records = []
  log.info('Linear ramp: ' + totalConnections + ' connections, one at a time')

  const delayPerConnection = Math.floor(CONFIG.batchDelayMs / CONFIG.batchSize)

  for (let i = 0; i < totalConnections; i++) {
    const portfolioId = CONFIG.portfolioIdPrefix + '-' + i
    const userId = 'GLOADTEST' + String(i).padStart(20, '0')
    const token = CONFIG.authEnabled ? generateTestToken(portfolioId, userId) : null

    try {
      const record = await connectPortfolioFeed(portfolioId, userId, token)
      records.push(record)
      if ((i + 1) % 50 === 0 || i === totalConnections - 1) {
        log.info('Connected: ' + (i + 1) + '/' + totalConnections)
      }
    } catch (err) {
      log.verbose('Connection ' + i + ' failed', { error: err.message })
    }

    if (i < totalConnections - 1) {
      await sleep(delayPerConnection)
    }
  }

  return records
}

// ─── Test execution ──────────────────────────────────────────────────────────

/**
 * Run the full load test: ramp up connections, sustain load, collect metrics
 */
async function runLoadTest() {
  log.info('═══════════════════════════════════════════════════════════════')
  log.info('WebSocket Portfolio Feed Load Test')
  log.info('═══════════════════════════════════════════════════════════════')
  log.info('Configuration', {
    backendUrl: CONFIG.backendUrl,
    wsBaseUrl,
    concurrentConnections: CONFIG.concurrentConnections,
    batchSize: CONFIG.batchSize,
    batchDelayMs: CONFIG.batchDelayMs,
    durationMs: CONFIG.durationMs,
    authEnabled: CONFIG.authEnabled,
    rampStrategy: CONFIG.rampStrategy,
    timeoutMs: CONFIG.timeoutMs,
  })

  // ── Phase 1: Verify backend is reachable ──────────────────────────────────
  log.info('Phase 1: Verifying backend is reachable...')
  try {
    const healthRes = await fetch(CONFIG.backendUrl + '/health')
    const healthText = await healthRes.text()
    if (healthRes.ok) {
      log.pass('Backend health check OK: ' + healthText)
    } else {
      log.warn('Backend health check returned ' + healthRes.status + ': ' + healthText)
    }
  } catch (err) {
    log.error('Backend unreachable. Is it running at ' + CONFIG.backendUrl + '?', { error: err.message })
    process.exit(1)
  }

  // ── Phase 2: Ramp up connections ──────────────────────────────────────────
  log.info('Phase 2: Ramping up connections...')
  const rampStart = Date.now()

  let records = []
  if (CONFIG.rampStrategy === 'linear') {
    records = await linearRamp(CONFIG.concurrentConnections)
  } else {
    records = await batchRamp(CONFIG.concurrentConnections)
  }

  const rampDuration = Date.now() - rampStart
  const openCount = records.filter((r) => r.ws && r.ws.readyState === 1).length

  log.info('Ramp complete', {
    durationMs: rampDuration,
    attemptedConnections: CONFIG.concurrentConnections,
    succeededConnections: latencyMetrics.connectionsSucceeded,
    failedConnections: latencyMetrics.connectionsFailed,
    currentlyOpen: openCount,
  })

  if (openCount === 0) {
    log.error('No connections are open. Aborting test.')
    process.exit(1)
  }

  // ── Phase 3: Sustain load and measure message delivery ────────────────────
  log.info('Phase 3: Sustaining load for ' + CONFIG.durationMs + 'ms...')
  log.info('Collecting message delivery metrics...')

  // Start resource monitoring (client + server)
  resourceSamples.push(sampleResourceUsage())
  let serverResourceSamples = []
  const resourceMonitor = setInterval(async () => {
    resourceSamples.push(sampleResourceUsage())
    const serverMetrics = await fetchBackendResourceUsage()
    if (serverMetrics) {
      serverResourceSamples.push({ timestamp: Date.now(), ...serverMetrics })
    }
  }, 5000)

  // Wait for the configured duration
  const sustainStart = Date.now()
  const progressInterval = Math.max(5000, Math.floor(CONFIG.durationMs / 10))
  while (Date.now() - sustainStart < CONFIG.durationMs) {
    await sleep(progressInterval)
    const elapsed = Date.now() - sustainStart
    const pct = Math.round((elapsed / CONFIG.durationMs) * 100)
    const stillOpen = records.filter((r) => r.ws && r.ws.readyState === 1).length
    log.info('Sustain progress: ' + pct + '%', {
      elapsedMs: elapsed,
      connectionsOpen: stillOpen,
      messagesReceived: latencyMetrics.totalMessagesReceived,
      connectionsDropped: latencyMetrics.connectionsDropped,
    })
  }

  clearInterval(resourceMonitor)
  resourceSamples.push(sampleResourceUsage())

  const sustainDuration = Date.now() - sustainStart
  const finalOpenCount = records.filter((r) => r.ws && r.ws.readyState === 1).length
  log.info('Sustain complete', {
    durationMs: sustainDuration,
    connectionsSurvived: finalOpenCount,
    connectionsDropped: latencyMetrics.connectionsDropped,
  })

  // ── Phase 4: Tear down ────────────────────────────────────────────────────
  log.info('Phase 4: Tearing down connections...')
  closeAllConnections(records)

  // Give connections time to close gracefully
  await sleep(2000)

  // ── Phase 5: Generate report ──────────────────────────────────────────────
  log.info('Phase 5: Generating report...')
  const report = generateReport(records, rampDuration, sustainDuration, serverResourceSamples)

  // Write results to disk if configured
  if (process.env.CHAOS_WS_RESULTS_DIR) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = process.env.CHAOS_WS_RESULTS_DIR
    fs.default.mkdirSync(dir, { recursive: true })
    const resultsPath = path.default.join(dir, 'ws-load-test-results.json')
    const resultsData = {
      timestamp: new Date().toISOString(),
      configuration: CONFIG,
      connectionSummary: {
        totalAttempted: CONFIG.concurrentConnections,
        succeeded: latencyMetrics.connectionsSucceeded,
        failed: latencyMetrics.connectionsFailed,
        droppedDuringTest: latencyMetrics.connectionsDropped,
        rampDurationMs: rampDuration,
        sustainDurationMs: sustainDuration,
      },
      latencies: {
        connectionAcceptance: buildPercentileReport(latencyMetrics.connectionLatencies),
        firstMessageDelivery: buildPercentileReport(latencyMetrics.firstMessageLatencies),
        messageDelivery: buildPercentileReport(latencyMetrics.messageDeliveryLatencies),
      },
      throughput: {
        totalMessagesReceived: latencyMetrics.totalMessagesReceived,
        messagesPerSecond: Math.round(latencyMetrics.totalMessagesReceived / Math.max(sustainDuration / 1000, 1)),
      },
      ceiling: report,
    }
    fs.default.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2))
    log.info('Results written to ' + resultsPath)
  }

  return { records, rampDuration, sustainDuration }
}

// ─── Report generation ───────────────────────────────────────────────────────

function generateReport(records, rampDurationMs, sustainDurationMs, serverResourceSamples) {
  const conn = latencyMetrics
  const totalAttempted = CONFIG.concurrentConnections
  const succeededPct =
    totalAttempted > 0
      ? Math.round((conn.connectionsSucceeded / totalAttempted) * 100)
      : 0

  log.info('═══════════════════════════════════════════════════════════════')
  log.info('LOAD TEST REPORT — WebSocket Portfolio Feed')
  log.info('═══════════════════════════════════════════════════════════════')

  // Connection summary
  log.info('── Connection Summary ──')
  log.info('', {
    totalAttempted,
    succeeded: conn.connectionsSucceeded,
    failed: conn.connectionsFailed,
    successRate: succeededPct + '%',
    droppedDuringTest: conn.connectionsDropped,
    rampDurationMs,
    sustainDurationMs,
    totalDurationMs: rampDurationMs + sustainDurationMs,
  })

  // Connection acceptance latency
  log.info('── Connection Acceptance Latency (ms) ──')
  if (conn.connectionLatencies.length > 0) {
    log.metric('', {
      p50: percentile(conn.connectionLatencies, 50),
      p75: percentile(conn.connectionLatencies, 75),
      p95: percentile(conn.connectionLatencies, 95),
      p99: percentile(conn.connectionLatencies, 99),
      max: Math.max(...conn.connectionLatencies),
      mean: Math.round(mean(conn.connectionLatencies)),
      min: Math.min(...conn.connectionLatencies),
      sampleSize: conn.connectionLatencies.length,
    })
  } else {
    log.warn('No connection latency data collected')
  }

  // First message delivery latency (ACK to first PORTFOLIO_VALUE_UPDATE)
  log.info('── First Message Delivery Latency (ms) ──')
  if (conn.firstMessageLatencies.length > 0) {
    log.metric('', {
      p50: percentile(conn.firstMessageLatencies, 50),
      p95: percentile(conn.firstMessageLatencies, 95),
      p99: percentile(conn.firstMessageLatencies, 99),
      max: Math.max(...conn.firstMessageLatencies),
      mean: Math.round(mean(conn.firstMessageLatencies)),
      min: Math.min(...conn.firstMessageLatencies),
      sampleSize: conn.firstMessageLatencies.length,
    })
  } else {
    log.warn('No first-message latency data collected')
  }

  // Message delivery latency (server timestamp to client receipt)
  log.info('── Message Delivery Latency (server→client, ms) ──')
  if (conn.messageDeliveryLatencies.length > 0) {
    log.metric('', {
      p50: percentile(conn.messageDeliveryLatencies, 50),
      p95: percentile(conn.messageDeliveryLatencies, 95),
      p99: percentile(conn.messageDeliveryLatencies, 99),
      max: Math.max(...conn.messageDeliveryLatencies),
      mean: Math.round(mean(conn.messageDeliveryLatencies)),
      min: Math.min(...conn.messageDeliveryLatencies),
      sampleSize: conn.messageDeliveryLatencies.length,
    })
  } else {
    log.warn('No message delivery latency data collected')
  }

  // Message throughput
  log.info('── Message Throughput ──')
  const totalSustainSec = sustainDurationMs / 1000
  log.metric('', {
    totalMessagesReceived: conn.totalMessagesReceived,
    messagesPerSecond: Math.round(conn.totalMessagesReceived / Math.max(totalSustainSec, 1)),
    connectionsAtPeak: CONFIG.concurrentConnections,
  })

  // Server resource usage (from /metrics endpoint)
  log.info('── Server Resource Usage (via /metrics) ──')
  if (serverResourceSamples && serverResourceSamples.length > 0) {
    const first = serverResourceSamples[0]
    const last = serverResourceSamples[serverResourceSamples.length - 1]
    log.metric('', {
      samplesCollected: serverResourceSamples.length,
      firstSample: first,
      lastSample: last,
    })
  } else {
    log.info('Server resource metrics unavailable (/metrics endpoint not reachable)')
  }

  // Client-side resource usage (load generator overhead)
  log.info('── Client Resource Usage (load generator overhead) ──')
  if (resourceSamples.length > 0) {
    const first = resourceSamples[0]
    const last = resourceSamples[resourceSamples.length - 1]
    log.metric('', {
      heapUsedMB_start: first.heapUsedMB,
      heapUsedMB_end: last.heapUsedMB,
      heapUsedDeltaMB: Math.round((last.heapUsedMB - first.heapUsedMB) * 100) / 100,
      rssMB_start: first.rssMB,
      rssMB_end: last.rssMB,
      rssDeltaMB: Math.round((last.rssMB - first.rssMB) * 100) / 100,
      externalMB_start: first.externalMB,
      externalMB_end: last.externalMB,
    })
  }

  // Practical ceiling assessment
  log.info('── Capacity Planning: Concurrent Connection Ceiling ──')
  const ceiling = assessCeiling()
  log.info('', ceiling)

  log.info('═══════════════════════════════════════════════════════════════')

  return ceiling
}

function assessCeiling() {
  const conn = latencyMetrics

  // Determine ceiling based on failure rate, latency degradation, and drops
  const failureRate =
    CONFIG.concurrentConnections > 0
      ? conn.connectionsFailed / CONFIG.concurrentConnections
      : 0
  const dropRate =
    conn.connectionsSucceeded > 0
      ? conn.connectionsDropped / conn.connectionsSucceeded
      : 0
  const p95ConnectLatency = percentile(conn.connectionLatencies, 95)

  // Scoring for ceiling assessment
  const issues = []

  if (failureRate > 0.1) {
    issues.push('High connection failure rate (' + Math.round(failureRate * 100) + '%)')
  }
  if (dropRate > 0.05) {
    issues.push('Connection drops detected (' + Math.round(dropRate * 100) + '% of open connections)')
  }
  if (p95ConnectLatency > 5000) {
    issues.push('P95 connection latency exceeds 5s (' + p95ConnectLatency + 'ms)')
  }
  if (conn.messageDeliveryLatencies.length > 0) {
    const p95Delivery = percentile(conn.messageDeliveryLatencies, 95)
    if (p95Delivery > 2000) {
      issues.push('P95 message delivery latency exceeds 2s (' + p95Delivery + 'ms)')
    }
  }

  let ceiling, recommendation

  if (issues.length === 0) {
    ceiling = '>= ' + CONFIG.concurrentConnections + ' concurrent connections'
    recommendation =
      'System handled ' +
      CONFIG.concurrentConnections +
      ' connections without significant issues. ' +
      'Consider running with higher CHAOS_WS_CONCURRENT_CONNECTIONS to find the true ceiling.'
  } else {
    // Estimate ceiling as a fraction of tested connections
    const penaltyFactor = Math.max(0.3, 1 - failureRate - dropRate)
    const estimatedCeiling = Math.floor(CONFIG.concurrentConnections * penaltyFactor)
    ceiling = '~' + estimatedCeiling + ' concurrent connections (estimated)'
    recommendation =
      'System showed signs of stress at ' +
      CONFIG.concurrentConnections +
      ' connections: ' +
      issues.join('; ') +
      '. ' +
      'For production, recommend capacity planning around ' +
      estimatedCeiling +
      ' connections with current infrastructure sizing.'
  }

  return {
    testedConnections: CONFIG.concurrentConnections,
    assessedCeiling: ceiling,
    issues: issues,
    recommendation: recommendation,
    failureRate: Math.round(failureRate * 100) + '%',
    dropRate: Math.round(dropRate * 100) + '%',
    p95ConnectLatencyMs: p95ConnectLatency,
    p95DeliveryLatencyMs:
      conn.messageDeliveryLatencies.length > 0
        ? percentile(conn.messageDeliveryLatencies, 95)
        : 'n/a',
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  let testResources = null

  try {
    testResources = await runLoadTest()
  } catch (err) {
    log.error('Load test failed with error', { error: err.message })
    if (err.stack) {
      log.verbose(err.stack)
    }
    process.exit(1)
  }

  // Final verdict
  const failedConnections = latencyMetrics.connectionsFailed
  const failedThreshold = Math.max(1, Math.floor(CONFIG.concurrentConnections * 0.5))

  if (failedConnections >= failedThreshold) {
    log.fail(
      'Load test FAILED: ' +
        failedConnections +
        ' connection failures out of ' +
        CONFIG.concurrentConnections +
        ' attempted (threshold: ' +
        failedThreshold +
        ')',
    )
    process.exit(1)
  }

  log.pass(
    'Load test PASSED: ' +
      latencyMetrics.connectionsSucceeded +
      ' connections succeeded out of ' +
      CONFIG.concurrentConnections +
      ' attempted',
  )
}

main().catch((err) => {
  log.error('Unhandled error in load test', { error: err.message })
  if (err.stack) log.verbose(err.stack)
  process.exit(1)
})
