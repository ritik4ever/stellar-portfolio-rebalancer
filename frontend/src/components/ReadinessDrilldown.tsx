import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, MinusCircle, Loader2, Clock } from 'lucide-react'
import type { ReadinessReport } from '../hooks/useReadinessReport'
import type { ReadinessHistoryEntry } from '../hooks/useReadinessHistory'

type Props = {
    report: ReadinessReport | null
    loading: boolean
    loadError: boolean
    history?: ReadinessHistoryEntry[]
    historyLoading?: boolean
    historyError?: boolean
}

const CHECK_LABELS: Record<string, string> = {
    database: 'Database',
    queue: 'Job Queue',
    workers: 'Workers',
    contractEventIndexer: 'Event Indexer',
    autoRebalancer: 'Auto-Rebalancer',
}

function formatTime(ts: string): string {
    try {
        const d = new Date(ts)
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    } catch {
        return ts
    }
}

function formatDate(ts: string): string {
    try {
        const d = new Date(ts)
        const today = new Date()
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        if (d.toDateString() === today.toDateString()) return 'Today'
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch {
        return ts
    }
}

export default function ReadinessDrilldown({ report, loading, loadError, history, historyLoading, historyError }: Props) {
    const [open, setOpen] = useState(false)

    const isFullyReady = report?.status === 'ready'

    // Only show the drilldown toggle when something is not ready
    if (!loading && !loadError && isFullyReady) return null

    const statusLabel = loading
        ? 'Checking services…'
        : loadError
          ? 'Service status unavailable'
          : 'Some services degraded'

    const statusColor = loading
        ? 'text-slate-500 dark:text-slate-400'
        : loadError
          ? 'text-slate-600 dark:text-slate-300'
          : 'text-amber-700 dark:text-amber-300'

    const hasHistoryItems = history && history.length > 0

    return (
        <div className="mt-1.5 text-xs">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`flex items-center gap-1 font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-current ${statusColor}`}
                aria-expanded={open}
                aria-controls="readiness-drilldown-panel"
            >
                {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                )}
                {statusLabel}
                {open ? (
                    <ChevronUp className="h-3 w-3" aria-hidden />
                ) : (
                    <ChevronDown className="h-3 w-3" aria-hidden />
                )}
            </button>

            {open && (
                <div
                    id="readiness-drilldown-panel"
                    className="mt-1.5 space-y-2 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
                >
                    {loadError && !report && (
                        <p className="text-slate-500 dark:text-slate-400 italic">
                            Could not reach the readiness endpoint.
                        </p>
                    )}
                    {report && (
                        <ul role="list" className="space-y-1">
                            {(Object.entries(report.checks) as [string, { status: string; message: string }][]).map(
                                ([key, check]) => (
                                    <li key={key} className="flex items-start gap-2">
                                        {check.status === 'ready' ? (
                                            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" aria-label="ready" />
                                        ) : check.status === 'disabled' ? (
                                            <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="disabled" />
                                        ) : (
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="degraded" />
                                        )}
                                        <span>
                                            <span className="font-medium text-slate-800 dark:text-slate-100">
                                                {CHECK_LABELS[key] ?? key}
                                            </span>
                                            {check.status !== 'ready' && (
                                                <span className="ml-1 text-slate-500 dark:text-slate-400">
                                                    — {check.message}
                                                </span>
                                            )}
                                        </span>
                                    </li>
                                ),
                            )}
                        </ul>
                    )}
                    {hasHistoryItems && (
                        <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
                            <div className="flex items-center gap-1 mb-1.5 text-slate-500 dark:text-slate-400">
                                <Clock className="h-3 w-3" aria-hidden />
                                <span className="text-[11px] font-medium uppercase tracking-wider">Readiness history</span>
                            </div>
                            <div className="space-y-0.5">
                                {history.map((entry, idx) => {
                                    const isDegraded = entry.status === 'not_ready'
                                    return (
                                        <div key={`${entry.timestamp}-${idx}`} className="flex items-center gap-2 text-xs">
                                            <span
                                                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                                                    isDegraded ? 'bg-amber-400' : 'bg-green-400'
                                                }`}
                                                aria-label={isDegraded ? 'degraded' : 'healthy'}
                                            />
                                            <span className="text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                                                {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
                                            </span>
                                            <span
                                                className={`${
                                                    isDegraded
                                                        ? 'text-amber-700 dark:text-amber-300'
                                                        : 'text-green-700 dark:text-green-300'
                                                }`}
                                            >
                                                {entry.summary}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    {historyLoading && (
                        <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            <span>Loading history...</span>
                        </div>
                    )}
                    {historyError && !hasHistoryItems && (
                        <p className="text-slate-500 dark:text-slate-400 italic">
                            Could not load readiness history.
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
