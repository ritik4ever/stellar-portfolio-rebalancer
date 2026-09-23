import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { trace } from '@opentelemetry/api'
import { Horizon, SorobanRpc } from '@stellar/stellar-sdk'

function getTracer() {
  return trace.getTracer('stellar-service', '1.0.0')
}

function getHorizonServer(): Horizon.Server {
  const network = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase()
  const horizonUrl = process.env.STELLAR_HORIZON_URL || 
    (network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org')
  return new Horizon.Server(horizonUrl)
}

// ─────────────────────────────────────────────────────────────────────────────
// Soroban RPC endpoint pool with failover and health-based steering
// ─────────────────────────────────────────────────────────────────────────────

export interface SorobanRpcEndpointHealth {
  url: string
  healthy: boolean
  consecutiveFailures: number
  /** EWMA of the last successful call latency (ms). `null` = no sample yet. */
  averageLatencyMs: number | null
  lastUsedAt: number | null
  lastError?: string
  /** Timestamp before which the endpoint is not retried after a failure. */
  nextRetryAt: number | null
}

export interface SorobanRpcPoolOptions {
  /** Per-call timeout in ms. Calls that exceed it count as a failure. */
  timeoutMs?: number
  /** Cooldown (ms) after a failure before an endpoint is probed again. */
  cooldownMs?: number
  /** Optional factory so tests can inject mocked RPC servers. */
  serverFactory?: (url: string) => SorobanRpc.Server
}

const RPC_TIMEOUT_MS_DEFAULT = 10_000
const RPC_COOLDOWN_MS_DEFAULT = 5_000
const LATENCY_EWMA_ALPHA = 0.3

function sorobanRpcTimeoutMs(): number {
  const parsed = Number(process.env.SOROBAN_RPC_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RPC_TIMEOUT_MS_DEFAULT
}

function defaultSorobanRpcUrl(): string {
  const network = (process.env.STELLAR_NETWORK || 'testnet').trim().toLowerCase()
  return network === 'mainnet'
    ? 'https://soroban-rpc.mainnet.stellar.gateway.fm'
    : 'https://soroban-testnet.stellar.org'
}

/**
 * Resolve the list of configured Soroban RPC endpoints.
 *
 * `SOROBAN_RPC_URLS` (comma-separated) is preferred when present; falls back
 * to the legacy single `SOROBAN_RPC_URL`, then to a network default. Duplicate
 * URLs are collapsed.
 */
export function resolveSorobanRpcUrls(): string[] {
  const multi = process.env.SOROBAN_RPC_URLS
  const single = process.env.SOROBAN_RPC_URL
  const raw = multi && multi.trim() ? multi : (single ? single : '')
  const urls = raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  return urls.length > 0 ? [...new Set(urls)] : [defaultSorobanRpcUrl()]
}

export interface SorobanRpcPoolStatus {
  endpoints: SorobanRpcEndpointHealth[]
  preferredUrl: string | undefined
  timeoutMs: number
  cooldownMs: number
}

/**
 * Failover-aware pool over a list of Soroban RPC endpoints.
 *
 * `call()` attempts the healthiest endpoint first and transparently falls back
 * to the next endpoint on connection failure or timeout. Per-endpoint
 * health and smoothed latency are tracked so subsequent calls steer toward
 * the most responsive endpoint.
 */
export class SorobanRpcEndpointPool {
  private readonly endpoints: SorobanRpcEndpointHealth[]
  private readonly servers: Map<string, SorobanRpc.Server>
  private readonly serverFactory: (url: string) => SorobanRpc.Server
  private readonly timeoutMs: number
  private readonly cooldownMs: number

  constructor(endpoints: string[], options: SorobanRpcPoolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? sorobanRpcTimeoutMs()
    this.cooldownMs = options.cooldownMs ?? RPC_COOLDOWN_MS_DEFAULT
    this.serverFactory = options.serverFactory ?? ((url: string) =>
      new SorobanRpc.Server(url, { allowHttp: url.startsWith('http://') }))
    this.servers = new Map()
    this.endpoints = [...new Set(endpoints)].map((url) => ({
      url,
      healthy: true,
      consecutiveFailures: 0,
      averageLatencyMs: null,
      lastUsedAt: null,
      nextRetryAt: null,
    }))
  }

  getEndpointHealths(): SorobanRpcEndpointHealth[] {
    return this.endpoints
  }

  getStatus(): SorobanRpcPoolStatus {
    return {
      endpoints: this.endpoints.map((e) => ({ ...e })),
      preferredUrl: this.candidateOrder()[0]?.url,
      timeoutMs: this.timeoutMs,
      cooldownMs: this.cooldownMs,
    }
  }

  /**
   * The single most responsive (healthy) endpoint, for callers that hold a
   * `SorobanRpc.Server` rather than going through `call()`.
   */
  getServer(): SorobanRpc.Server {
    const preferred = this.candidateOrder()[0]
    const url = preferred?.url ?? this.endpoints[0]?.url ?? ''
    return this.getServerForUrl(url)
  }

  private getServerForUrl(url: string): SorobanRpc.Server {
    let server = this.servers.get(url)
    if (!server) {
      server = this.serverFactory(url)
      this.servers.set(url, server)
    }
    return server
  }

  /**
   * Run an RPC invocation against the pool. The healthiest endpoint is tried
   * first; on connection failure or timeout the next endpoint is attempted
   * until one succeeds. Throws the last error when every endpoint fails.
   */
  async call<T>(fn: (server: SorobanRpc.Server) => Promise<T>): Promise<T> {
    let lastError: Error | undefined
    for (const endpoint of this.candidateOrder()) {
      const server = this.getServerForUrl(endpoint.url)
      const startedAt = Date.now()
      try {
        const result = await this.withTimeout(fn(server), this.timeoutMs)
        this.recordSuccess(endpoint, Date.now() - startedAt)
        return result
      } catch (err) {
        this.recordFailure(endpoint, err)
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
    throw lastError ?? new Error('No Soroban RPC endpoints configured')
  }

  /**
   * Order endpoints by preference:
   *   1. healthy endpoints, fastest EWMA latency first (unknown latency last)
   *   2. unhealthy endpoints whose cooldown has elapsed (re-probe candidates)
   *   3. unhealthy endpoints still cooling down (avoid hammering them)
   */
  private candidateOrder(): SorobanRpcEndpointHealth[] {
    const now = Date.now()
    const healthy = this.endpoints
      .filter((e) => e.healthy)
      .sort((a, b) => {
        const latA = a.averageLatencyMs ?? Number.POSITIVE_INFINITY
        const latB = b.averageLatencyMs ?? Number.POSITIVE_INFINITY
        if (latA !== latB) return latA - latB
        return this.endpoints.indexOf(a) - this.endpoints.indexOf(b)
      })
    const probing = this.endpoints
      .filter((e) => !e.healthy && (e.nextRetryAt ?? 0) <= now)
      .sort((a, b) => this.endpoints.indexOf(a) - this.endpoints.indexOf(b))
    const coolingDown = this.endpoints
      .filter((e) => !e.healthy && (e.nextRetryAt ?? 0) > now)
      .sort((a, b) => this.endpoints.indexOf(a) - this.endpoints.indexOf(b))
    return [...healthy, ...probing, ...coolingDown]
  }

  private recordSuccess(endpoint: SorobanRpcEndpointHealth, latencyMs: number): void {
    endpoint.healthy = true
    endpoint.consecutiveFailures = 0
    endpoint.averageLatencyMs =
      endpoint.averageLatencyMs === null
        ? latencyMs
        : endpoint.averageLatencyMs * (1 - LATENCY_EWMA_ALPHA) + latencyMs * LATENCY_EWMA_ALPHA
    endpoint.lastUsedAt = Date.now()
    endpoint.lastError = undefined
  }

  private recordFailure(endpoint: SorobanRpcEndpointHealth, err: unknown): void {
    endpoint.consecutiveFailures += 1
    endpoint.healthy = false
    endpoint.nextRetryAt = Date.now() + this.cooldownMs
    endpoint.lastUsedAt = Date.now()
    endpoint.lastError = err instanceof Error ? err.message : String(err)
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (!ms || ms <= 0) return promise
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Soroban RPC call timed out')), ms)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

const sorobanRpcUrls = resolveSorobanRpcUrls()
/** Shared pool for the process; used by the contract event indexer etc. */
export const sorobanRpcEndpointPool = new SorobanRpcEndpointPool(sorobanRpcUrls)

export interface ExecuteRebalanceOptions {
    simulateOnly?: boolean
    ignoreSafetyChecks?: boolean
    tradeSlippageOverrides?: Record<string, number>
}

export interface RebalanceDryRunResult {
    portfolioId: string
    canExecute: boolean
    overallStatus: string
    trigger: string
    estimatedTrades: any[]
    skippedTrades: any[]
    skippedAssets: any[]
    guardrails: {
        riskManagement: { allowed: boolean; reason: string }
        cooldown: { allowed: boolean; reason: string }
        marketConditions: { allowed: boolean; reason: string }
        rebalanceRequired: { allowed: boolean; reason: string }
    }
    feeEstimate: { totalFeeXlm: number; totalFeeUsd: number; xlmPriceUsd: number }
    estimatedTotalSlippageBps: number
}

export class StellarService {
    private db: Database.Database

    constructor() {
        const dbPath = process.env.DB_PATH || './data/portfolio.db'
        this.db = new Database(dbPath)
    }

    async getPortfolio(portfolioId: string): Promise<any> {
        const span = getTracer().startSpan('stellar.getPortfolio')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            const row = this.db.prepare('SELECT * FROM portfolios WHERE id = ?').get(portfolioId) as any
            if (!row) {
                span.setAttribute('portfolio.found', false)
                return null
            }
            span.setAttribute('portfolio.found', true)
            return {
                id: row.id,
                userAddress: row.user_address,
                allocations: JSON.parse(row.allocations || '{}'),
                threshold: row.threshold,
                slippageTolerancePercent: row.slippage_tolerance_percent,
                balances: JSON.parse(row.balances || '{}'),
                totalValue: row.total_value,
                createdAt: row.created_at,
                lastRebalance: row.last_rebalance,
                version: row.version,
            }
        } finally {
            span.end()
        }
    }

    async checkRebalanceNeeded(portfolioId: string): Promise<boolean> {
        const span = getTracer().startSpan('stellar.checkRebalanceNeeded')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            return true
        } finally {
            span.end()
        }
    }

    async executeRebalance(portfolioId: string, options?: ExecuteRebalanceOptions): Promise<any> {
        const span = getTracer().startSpan('stellar.executeRebalance')
        span.setAttribute('portfolio.id', portfolioId)
        if (options) {
            span.setAttribute('rebalance.simulate_only', options.simulateOnly || false)
            span.setAttribute('rebalance.ignore_safety_checks', options.ignoreSafetyChecks || false)
        }
        try {
            return {
                trades: 0,
                gasUsed: '0 XLM',
                timestamp: new Date().toISOString(),
                status: 'success',
                newBalances: {},
            }
        } finally {
            span.end()
        }
    }

    async dryRunRebalance(portfolioId: string, options?: ExecuteRebalanceOptions): Promise<RebalanceDryRunResult> {
        const span = getTracer().startSpan('stellar.dryRunRebalance')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            return {
                portfolioId,
                canExecute: true,
                overallStatus: 'ready',
                trigger: 'Threshold exceeded',
                estimatedTrades: [],
                skippedTrades: [],
                skippedAssets: [],
                guardrails: {
                    riskManagement: { allowed: true, reason: 'OK' },
                    cooldown: { allowed: true, reason: 'OK' },
                    marketConditions: { allowed: true, reason: 'OK' },
                    rebalanceRequired: { allowed: true, reason: 'OK' },
                },
                feeEstimate: { totalFeeXlm: 0, totalFeeUsd: 0, xlmPriceUsd: 0.35 },
                estimatedTotalSlippageBps: 0,
            }
        } finally {
            span.end()
        }
    }

    async createPortfolio(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        slippageTolerancePercent: number,
        strategy: string,
        strategyConfig: Record<string, unknown>,
        name?: string,
        description?: string,
    ): Promise<string> {
        const span = getTracer().startSpan('stellar.createPortfolio')
        span.setAttribute('user.address', userAddress)
        span.setAttribute('portfolio.threshold', threshold)
        span.setAttribute('portfolio.strategy', strategy)
        try {
            const id = randomUUID()
            const now = new Date().toISOString()
            this.db.prepare(`
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, name, description)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
            `).run(id, userAddress, JSON.stringify(allocations), threshold, slippageTolerancePercent, '{}', now, now, name ?? null, description ?? null)
            span.setAttribute('portfolio.id', id)
            return id
        } finally {
            span.end()
        }
    }

    async estimateRebalanceGas(portfolioId: string): Promise<{ estimatedGasXlm: string; estimatedGasUsd: string }> {
        const span = getTracer().startSpan('stellar.estimateRebalanceGas')
        span.setAttribute('portfolio.id', portfolioId)
        try {
            return { estimatedGasXlm: '0', estimatedGasUsd: '0' }
        } finally {
            span.end()
        }
    }

    async syncAccountBalance(address: string): Promise<{ balances: Record<string, string>; lastUpdated: string }> {
        const span = getTracer().startSpan('stellar.syncAccountBalance')
        span.setAttribute('account.address', address)
        try {
            const server = getHorizonServer()
            const account = await server.loadAccount(address)
            
            const balances: Record<string, string> = {}
            
            for (const balance of account.balances) {
                if (balance.asset_type === 'native') {
                    balances['XLM'] = balance.balance
                } else {
                    const assetCode = balance.asset_code
                    const assetIssuer = balance.asset_issuer
                    const key = `${assetCode}:${assetIssuer}`
                    balances[key] = balance.balance
                }
            }
            
            span.setAttribute('balances.count', Object.keys(balances).length)
            
            return {
                balances,
                lastUpdated: new Date().toISOString()
            }
        } finally {
            span.end()
        }
    }
}
