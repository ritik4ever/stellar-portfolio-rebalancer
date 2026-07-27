import { useQuery, useMutation, type QueryKey } from '@tanstack/react-query'
import { ENDPOINTS } from '../../config/api'
import { api } from '../../config/api'
import { adminRequest } from '../../services/adminService'
import type { CircuitBreakerStatus } from '../../types'

export type QueueHealthData = {
    success: boolean
    data: {
        redisConnected: boolean
        queues: Record<string, { waiting: number; active: number; completed: number; failed: number; delayed: number }>
        workers: Record<
            string,
            {
                name: string
                state: string
                lastHeartbeat?: string
                processedCount?: number
                failedCount?: number
            }
        >
    }
    timestamp: string
}

export type WorkersHealthData = {
    success: boolean
    data: {
        timestamp: string
        summary: { total: number; healthy: number; unhealthy: number; idle: number; lagging: number }
        workers: Array<{
            name: string
            state: string
            lastHeartbeat?: string
            processedCount?: number
            failedCount?: number
            isHealthy?: boolean
        }>
    }
}

export type SystemStatusData = {
    success: boolean
    data: {
        system: { status: string; uptime: number; timestamp: string; version: string }
        portfolios: { total: number; active: number }
        riskManagement: {
            circuitBreakers: Record<string, CircuitBreakerStatus>
            enabled: boolean
            alertsActive: boolean
        }
        services: {
            priceFeeds: boolean
            riskManagement: boolean
            webSockets: boolean
            autoRebalancing: boolean
            stellarNetwork: boolean
            contractEventIndexer: boolean
        }
        featureFlags?: Record<string, boolean>
    }
}

function isQueueHealth(v: unknown): v is QueueHealthData {
    if (!v || typeof v !== 'object') return false
    const o = v as Record<string, unknown>
    return (
        typeof o.success === 'boolean' &&
        typeof o.data === 'object' &&
        o.data !== null &&
        typeof (o.data as Record<string, unknown>).redisConnected === 'boolean'
    )
}

function isWorkersHealth(v: unknown): v is WorkersHealthData {
    if (!v || typeof v !== 'object') return false
    const o = v as Record<string, unknown>
    return (
        typeof o.success === 'boolean' &&
        typeof o.data === 'object' &&
        o.data !== null &&
        typeof (o.data as Record<string, unknown>).summary === 'object'
    )
}

function isSystemStatus(v: unknown): v is SystemStatusData {
    if (!v || typeof v !== 'object') return false
    const o = v as Record<string, unknown>
    return (
        typeof o.success === 'boolean' &&
        typeof o.data === 'object' &&
        o.data !== null &&
        typeof (o.data as Record<string, unknown>).riskManagement === 'object'
    )
}

async function fetchQueueHealth(): Promise<QueueHealthData | null> {
    try {
        const raw = await api.get(ENDPOINTS.QUEUE_HEALTH)
        return isQueueHealth(raw) ? raw : null
    } catch {
        return null
    }
}

async function fetchWorkersHealth(): Promise<WorkersHealthData | null> {
    try {
        const raw = await api.get(ENDPOINTS.WORKERS_HEALTH)
        return isWorkersHealth(raw) ? raw : null
    } catch {
        return null
    }
}

async function fetchSystemStatus(): Promise<SystemStatusData | null> {
    try {
        const raw = await api.get(ENDPOINTS.SYSTEM_STATUS)
        return isSystemStatus(raw) ? raw : null
    } catch {
        return null
    }
}

export const adminOpsKeys = {
    all: ['admin-ops'] as const,
    systemStatus: () => [...adminOpsKeys.all, 'system-status'] as QueryKey,
    queueHealth: () => [...adminOpsKeys.all, 'queue-health'] as QueryKey,
    workersHealth: () => [...adminOpsKeys.all, 'workers-health'] as QueryKey,
}

export function useSystemStatusQuery() {
    return useQuery({
        queryKey: adminOpsKeys.systemStatus(),
        queryFn: fetchSystemStatus,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        staleTime: 15_000,
    })
}

export function useQueueHealthQuery() {
    return useQuery({
        queryKey: adminOpsKeys.queueHealth(),
        queryFn: fetchQueueHealth,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        staleTime: 15_000,
    })
}

export function useWorkersHealthQuery() {
    return useQuery({
        queryKey: adminOpsKeys.workersHealth(),
        queryFn: fetchWorkersHealth,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        staleTime: 15_000,
    })
}

export function useResetCircuitBreakerMutation() {
    return useMutation({
        mutationFn: async (asset: string) => {
            return adminRequest<{ message: string; asset: string }>(
                ENDPOINTS.RISK_CIRCUIT_BREAKER_RESET(encodeURIComponent(asset)),
                { method: 'POST' }
            )
        },
    })
}
