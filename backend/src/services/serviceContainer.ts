import { RebalanceHistoryService } from './rebalanceHistory.js'
import { RiskManagementService } from './riskManagements.js'
import { databaseService } from './databaseService.js'
import { isRedisAvailable } from '../queue/connection.js'
import { ReflectorService } from './reflector.js'
import { logger } from '../utils/logger.js'

const riskManagementService = new RiskManagementService()
const rebalanceHistoryService = new RebalanceHistoryService(riskManagementService)

type DependencyStatus = 'ok' | 'degraded' | 'down'

interface DependencyHealth {
    status: DependencyStatus
    last_checked: string
    latency_ms: number
    details?: Record<string, unknown>
}

interface HealthSummary {
    status: 'healthy' | 'unhealthy'
    timestamp: string
    dependencies: Record<string, DependencyHealth>
}

const reflectorService = new ReflectorService()

async function checkDatabase(checkedAt: string): Promise<DependencyHealth> {
    const start = Date.now()
    try {
        const result = databaseService.getReadiness()
        return {
            status: result.ready ? 'ok' : 'down',
            latency_ms: Date.now() - start,
            last_checked: checkedAt,
            details: { path: result.databasePath }
        }
    } catch (err) {
        return {
            status: 'down',
            latency_ms: Date.now() - start,
            last_checked: checkedAt,
            details: { error: err instanceof Error ? err.message : String(err) }
        }
    }
}

async function checkRedis(checkedAt: string): Promise<DependencyHealth> {
    const start = Date.now()
    try {
        const available = await isRedisAvailable()
        return {
            status: available ? 'ok' : 'down',
            latency_ms: Date.now() - start,
            last_checked: checkedAt
        }
    } catch (err) {
        return {
            status: 'down',
            latency_ms: Date.now() - start,
            last_checked: checkedAt,
            details: { error: err instanceof Error ? err.message : String(err) }
        }
    }
}

async function checkSorobanRpc(checkedAt: string): Promise<DependencyHealth> {
    const start = Date.now()
    const rpcUrl = (
        process.env.SOROBAN_RPC_URL ||
        process.env.STELLAR_RPC_URL ||
        ((process.env.STELLAR_NETWORK || 'testnet').trim().toLowerCase() === 'mainnet'
            ? 'https://soroban-rpc.mainnet.stellar.gateway.fm'
            : 'https://soroban-testnet.stellar.org')
    ).trim()
    try {
        const resp = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
            signal: AbortSignal.timeout(5000)
        })
        const body = await resp.json().catch(() => null) as { result?: { status?: string } } | null
        const healthy = resp.ok && body?.result?.status === 'healthy'
        return {
            status: healthy ? 'ok' : 'degraded',
            latency_ms: Date.now() - start,
            last_checked: checkedAt,
            details: { rpcUrl }
        }
    } catch (err) {
        return {
            status: 'down',
            latency_ms: Date.now() - start,
            last_checked: checkedAt,
            details: { rpcUrl, error: err instanceof Error ? err.message : String(err) }
        }
    }
}

async function checkReflector(checkedAt: string): Promise<DependencyHealth> {
    const start = Date.now()
    try {
        const result = await reflectorService.testApiConnectivity()
        return {
            status: result.success ? 'ok' : 'degraded',
            latency_ms: Date.now() - start,
            last_checked: checkedAt
        }
    } catch (err) {
        return {
            status: 'down',
            latency_ms: Date.now() - start,
            last_checked: checkedAt,
            details: { error: err instanceof Error ? err.message : String(err) }
        }
    }
}

export async function buildDependencyHealthSummary(): Promise<HealthSummary> {
    const checkedAt = new Date().toISOString()

    const [database, redis, sorobanRpc, reflector] = await Promise.all([
        checkDatabase(checkedAt),
        checkRedis(checkedAt),
        checkSorobanRpc(checkedAt),
        checkReflector(checkedAt)
    ])

    const dependencies = { database, redis, sorobanRpc, reflector }
    const anyDown = Object.values(dependencies).some(d => d.status === 'down')

    return {
        status: anyDown ? 'unhealthy' : 'healthy',
        timestamp: checkedAt,
        dependencies
    }
}

export {
    riskManagementService,
    rebalanceHistoryService
}
