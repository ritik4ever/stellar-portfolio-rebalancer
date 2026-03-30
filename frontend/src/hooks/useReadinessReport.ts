import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_CONFIG } from '../config/api'

export type ReadinessCheckState = 'ready' | 'not_ready' | 'disabled'

export interface ReadinessCheck {
    status: ReadinessCheckState
    required: boolean
    message: string
}

export interface ReadinessReport {
    status: 'ready' | 'not_ready'
    timestamp: string
    uptimeSeconds?: number
    checks: {
        database: ReadinessCheck
        queue: ReadinessCheck
        workers: ReadinessCheck
        contractEventIndexer: ReadinessCheck
        autoRebalancer: ReadinessCheck
    }
}

export type CapabilityNoticeKind = 'disabled' | 'limited'

export interface CapabilityNotice {
    id: string
    kind: CapabilityNoticeKind
    text: string
}

function isReadinessCheck(v: unknown): v is ReadinessCheck {
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
        status: o.status,
        timestamp: typeof o.timestamp === 'string' ? o.timestamp : new Date().toISOString(),
        uptimeSeconds: typeof o.uptimeSeconds === 'number' ? o.uptimeSeconds : undefined,
        checks: {
            database: c.database as ReadinessCheck,
            queue: c.queue as ReadinessCheck,
            workers: c.workers as ReadinessCheck,
            contractEventIndexer: c.contractEventIndexer as ReadinessCheck,
            autoRebalancer: c.autoRebalancer as ReadinessCheck,
        },
    }
}

export function buildCapabilityNotices(report: ReadinessReport): CapabilityNotice[] {
    const out: CapabilityNotice[] = []
    const { checks } = report

    if (checks.database.status === 'not_ready') {
        out.push({
            id: 'database',
            kind: 'limited',
            text: 'The database check failed. Portfolio data and some actions may be unavailable until it recovers.',
        })
    }

    if (checks.queue.status === 'disabled' && checks.workers.status === 'disabled') {
        out.push({
            id: 'queue-workers',
            kind: 'disabled',
            text: 'Background jobs and queue workers are off (Redis not configured or unreachable). The REST API still works; automation and queued work stay paused.',
        })
    } else {
        if (checks.queue.status === 'disabled') {
            out.push({
                id: 'queue',
                kind: 'disabled',
                text: 'The job queue is turned off for this process. Scheduled or background jobs will not run until Redis is available.',
            })
        } else if (checks.queue.status === 'not_ready') {
            out.push({
                id: 'queue',
                kind: 'limited',
                text: 'The job queue is not fully ready. Background processing may be delayed.',
            })
        }

        if (checks.workers.status === 'disabled') {
            out.push({
                id: 'workers',
                kind: 'disabled',
                text: 'Queue workers are not running. Automated portfolio checks and similar tasks need a worker process with Redis.',
            })
        } else if (checks.workers.status === 'not_ready') {
            out.push({
                id: 'workers',
                kind: 'limited',
                text: 'One or more background workers are not ready yet. Automation may be paused until they finish starting.',
            })
        }
    }

    if (checks.contractEventIndexer.status === 'disabled') {
        out.push({
            id: 'indexer',
            kind: 'disabled',
            text: 'On-chain event indexing is disabled in this deployment by configuration. History and live sync from the chain are intentionally limited.',
        })
    } else if (checks.contractEventIndexer.status === 'not_ready') {
        out.push({
            id: 'indexer',
            kind: 'limited',
            text: 'On-chain indexing has not finished its startup sync. On-chain rebalance history may be incomplete for a short time.',
        })
    }

    if (checks.autoRebalancer.status === 'disabled') {
        out.push({
            id: 'auto-rebalancer',
            kind: 'disabled',
            text: 'Automatic rebalancing is off for this environment (by design). You can still review allocations and rebalance manually.',
        })
    } else if (checks.autoRebalancer.status === 'not_ready') {
        out.push({
            id: 'auto-rebalancer',
            kind: 'limited',
            text: 'Automatic rebalancing is enabled on the server but not fully initialized yet. Check Redis, workers, and server logs if this persists.',
        })
    }

    return out
}

async function fetchReadinessReport(signal: AbortSignal): Promise<ReadinessReport | null> {
    const base = API_CONFIG.BASE_URL.replace(/\/$/, '')
    const url = `${base}${API_CONFIG.ENDPOINTS.READINESS}`
    const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
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

export function useReadinessReport() {
    const [report, setReport] = useState<ReadinessReport | null>(null)
    const [loadError, setLoadError] = useState(false)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async (signal: AbortSignal) => {
        setLoading(true)
        setLoadError(false)
        try {
            const next = await fetchReadinessReport(signal)
            setReport(next)
            if (!next) setLoadError(true)
        } catch (e) {
            if ((e as Error).name === 'AbortError') return
            setLoadError(true)
            setReport(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        void load(controller.signal)
        const id = window.setInterval(() => {
            void load(controller.signal)
        }, POLL_MS)
        const onVis = () => {
            if (document.visibilityState === 'visible') void load(controller.signal)
        }
        document.addEventListener('visibilitychange', onVis)
        return () => {
            controller.abort()
            window.clearInterval(id)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [load])

    const notices = useMemo(() => (report ? buildCapabilityNotices(report) : []), [report])

    const refresh = useCallback(() => {
        const ac = new AbortController()
        void load(ac.signal)
    }, [load])

    return { report, notices, loadError, loading, refresh }
}
