import { useQuery } from '@tanstack/react-query'
import { API_CONFIG } from '../../config/api'
import type { ReadinessReport } from '../useReadinessReport'
import { buildCapabilityNotices, type CapabilityNotice } from '../useReadinessReport'
import { useMemo } from 'react'

export const readinessKeys = {
    all: ['readiness'] as const,
}

function isReadinessCheck(v: unknown): v is { status: string; required: boolean; message: string } {
    if (!v || typeof v !== 'object') return false
    const o = v as Record<string, unknown>
    return (
        (o.status === 'ready' || o.status === 'not_ready' || o.status === 'disabled') &&
        typeof o.required === 'boolean' &&
        typeof o.message === 'string'
    )
}

function parseReadinessReport(body: unknown): ReadinessReport | null {
    if (!body || typeof body !== 'object') return null
    const o = body as Record<string, unknown>
    if (o.status !== 'ready' && o.status !== 'not_ready') return null
    const checks = o.checks
    if (!checks || typeof checks !== 'object') return null
    const c = checks as Record<string, unknown>
    const keys = ['database', 'queue', 'workers', 'contractEventIndexer', 'autoRebalancer'] as const
    for (const k of keys) {
        if (!isReadinessCheck(c[k])) return null
    }
    return {
        status: o.status as 'ready' | 'not_ready',
        timestamp: typeof o.timestamp === 'string' ? o.timestamp : new Date().toISOString(),
        uptimeSeconds: typeof o.uptimeSeconds === 'number' ? o.uptimeSeconds : undefined,
        checks: c as ReadinessReport['checks'],
    }
}

async function fetchReadinessReport(): Promise<ReadinessReport | null> {
    const base = API_CONFIG.BASE_URL.replace(/\/$/, '')
    const url = `${base}${API_CONFIG.ENDPOINTS.READINESS}`
    const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        mode: 'cors',
        credentials: 'omit',
    })
    const ct = response.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
        return null
    }
    const body: unknown = await response.json()
    return parseReadinessReport(body)
}

const POLL_MS = 45_000

/**
 * React Query version of useReadinessReport.
 * Replaces manual setInterval polling with TanStack Query refetchInterval.
 */
export function useReadinessQuery() {
    const { data: report, isLoading: loading, isError: loadError, refetch: refresh } = useQuery({
        queryKey: readinessKeys.all,
        queryFn: fetchReadinessReport,
        refetchInterval: POLL_MS,
        refetchOnWindowFocus: true,
        staleTime: POLL_MS - 5000,
    })

    const notices: CapabilityNotice[] = useMemo(
        () => (report ? buildCapabilityNotices(report) : []),
        [report],
    )

    return { report: report ?? null, notices, loadError, loading, refresh }
}
