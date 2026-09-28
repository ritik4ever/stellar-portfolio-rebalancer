import React, { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { api, ENDPOINTS } from '../config/api'

export type PublicCheckStatus = 'ok' | 'degraded' | 'down'
export type PublicStatusOverall = 'healthy' | 'degraded' | 'unhealthy'

export interface PublicStatusCheck {
    status: PublicCheckStatus
    last_checked: string
    latency_ms: number
    /** Probe reason code, e.g. `ok`, `no_path`, `unreachable`. */
    reason: string
    message: string
    details?: Record<string, unknown>
}

export interface PublicStatusReport {
    status: PublicStatusOverall
    timestamp: string
    checks: {
        reflector_oracle: PublicStatusCheck
        stellar_dex: PublicStatusCheck
    }
    cache?: { cached: boolean; age_ms: number; ttl_ms: number }
}

interface SystemStatusPanelProps {
    /** Poll interval in ms; `0` disables polling. */
    pollIntervalMs?: number
    /** `full` adds the page-level heading used by the standalone `/status` page. */
    variant?: 'compact' | 'full'
}

export const DEFAULT_POLL_INTERVAL_MS = 30_000

const OVERALL_COPY: Record<PublicStatusOverall, string> = {
    healthy: 'All systems operational',
    degraded: 'Degraded performance',
    unhealthy: 'Connectivity problem',
}

const CHECK_STATUS_COPY: Record<PublicCheckStatus, string> = {
    ok: 'Operational',
    degraded: 'Degraded',
    down: 'Unavailable',
}

const CHECK_ROWS: Array<{ key: keyof PublicStatusReport['checks']; label: string; description: string }> = [
    {
        key: 'reflector_oracle',
        label: 'Reflector oracle',
        description: 'Primary price source for portfolio valuations.',
    },
    {
        key: 'stellar_dex',
        label: 'Stellar DEX',
        description: 'Routes rebalance trades through Horizon path finding.',
    },
]

const OVERALL_BADGE_CLASSES: Record<PublicStatusOverall, string> = {
    healthy: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100',
    degraded: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    unhealthy: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
}

const CHECK_TEXT_CLASSES: Record<PublicCheckStatus, string> = {
    ok: 'text-green-700 dark:text-green-300',
    degraded: 'text-amber-700 dark:text-amber-300',
    down: 'text-red-700 dark:text-red-300',
}

const CHECK_PILL_CLASSES: Record<PublicCheckStatus, string> = {
    ok: 'bg-green-50 text-green-800 ring-green-200 dark:bg-green-950/50 dark:text-green-200 dark:ring-green-800',
    degraded: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-amber-800',
    down: 'bg-red-50 text-red-900 ring-red-200 dark:bg-red-950/50 dark:text-red-100 dark:ring-red-800',
}

function CheckIcon({ status }: { status: PublicCheckStatus }) {
    if (status === 'ok') return <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
    if (status === 'degraded') return <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
    return <XCircle className="w-4 h-4 shrink-0" aria-hidden />
}

/** Fixed UTC clock text so the panel renders the same string in every locale. */
function formatCheckedAt(iso: string): string {
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return 'unknown'
    return `${parsed.toISOString().slice(11, 19)} UTC`
}

const SystemStatusPanel: React.FC<SystemStatusPanelProps> = ({
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    variant = 'compact',
}) => {
    const [report, setReport] = useState<PublicStatusReport | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            const data = await api.get<PublicStatusReport>(ENDPOINTS.STATUS)
            if (!data || !data.checks) {
                throw new Error('Status API returned an unexpected payload')
            }
            setReport(data)
            setError(null)
        } catch (err) {
            setReport(null)
            setError(err instanceof Error ? err.message : 'Unable to reach the status API')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    useEffect(() => {
        if (!pollIntervalMs || pollIntervalMs <= 0) return
        const timer = setInterval(() => {
            void load()
        }, pollIntervalMs)
        return () => clearInterval(timer)
    }, [load, pollIntervalMs])

    const handleRefresh = () => {
        setRefreshing(true)
        void load()
    }

    const headingId = variant === 'full' ? 'system-status-heading' : 'live-connectivity-heading'

    return (
        <div
            aria-labelledby={headingId}
            data-status={report ? report.status : error ? 'unavailable' : 'loading'}
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/80 p-6 shadow-sm"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
                    <h3 id={headingId} className={variant === 'full' ? 'text-2xl font-bold' : 'font-semibold'}>
                        Live connectivity
                    </h3>
                </div>
                <div className="flex items-center gap-3">
                    {report ? (
                        <span
                            data-testid="overall-status"
                            className={`rounded-full px-3 py-1 text-xs font-medium ${OVERALL_BADGE_CLASSES[report.status]}`}
                        >
                            {OVERALL_COPY[report.status]}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                        Refresh
                    </button>
                </div>
            </div>

            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Oracle and DEX connectivity, probed live by the API. Not a static claim.
            </p>

            {loading && !report && !error ? (
                <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">Checking live connectivity…</p>
            ) : null}

            {error ? (
                <div
                    role="alert"
                    className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                >
                    <p className="font-medium">Live status unavailable</p>
                    <p className="mt-1 opacity-90">{error}</p>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="mt-2 rounded-lg bg-white/85 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-50 dark:ring-amber-700"
                    >
                        Try again
                    </button>
                </div>
            ) : null}

            {report ? (
                <>
                    <ul className="mt-4 grid gap-3 md:grid-cols-2">
                        {CHECK_ROWS.map(({ key, label, description }) => {
                            const check = report.checks[key]
                            if (!check) return null
                            return (
                                <li
                                    key={key}
                                    data-check={key}
                                    data-status={check.status}
                                    className="rounded-xl border border-gray-200 dark:border-gray-700 p-4"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium text-gray-900 dark:text-white">{label}</span>
                                        <span
                                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CHECK_PILL_CLASSES[check.status]}`}
                                        >
                                            <CheckIcon status={check.status} />
                                            {CHECK_STATUS_COPY[check.status]}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
                                    <p className={`mt-2 text-sm ${CHECK_TEXT_CLASSES[check.status]}`}>{check.message}</p>
                                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                        <div className="flex gap-1">
                                            <dt>Latency</dt>
                                            <dd>{check.latency_ms} ms</dd>
                                        </div>
                                        <div className="flex gap-1">
                                            <dt>Checked</dt>
                                            <dd>
                                                <time dateTime={check.last_checked}>{formatCheckedAt(check.last_checked)}</time>
                                            </dd>
                                        </div>
                                        <div className="flex gap-1">
                                            <dt>Reason</dt>
                                            <dd className="font-mono">{check.reason}</dd>
                                        </div>
                                    </dl>
                                </li>
                            )
                        })}
                    </ul>

                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        Updated <time dateTime={report.timestamp}>{formatCheckedAt(report.timestamp)}</time>
                        {report.cache?.cached ? ' (cached response)' : ''}
                    </p>
                </>
            ) : null}
        </div>
    )
}

export default SystemStatusPanel
