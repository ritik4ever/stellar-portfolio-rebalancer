import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, MinusCircle, Loader2 } from 'lucide-react'
import type { ReadinessReport } from '../hooks/useReadinessReport'

type Props = {
    report: ReadinessReport | null
    loading: boolean
    loadError: boolean
}

const CHECK_LABELS: Record<string, string> = {
    database: 'Database',
    queue: 'Job Queue',
    workers: 'Workers',
    contractEventIndexer: 'Event Indexer',
    autoRebalancer: 'Auto-Rebalancer',
}

export default function ReadinessDrilldown({ report, loading, loadError }: Props) {
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
                <ul
                    id="readiness-drilldown-panel"
                    role="list"
                    className="mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
                >
                    {loadError && !report && (
                        <li className="text-slate-500 dark:text-slate-400 italic">
                            Could not reach the readiness endpoint.
                        </li>
                    )}
                    {report &&
                        (Object.entries(report.checks) as [string, { status: string; message: string }][]).map(
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
        </div>
    )
}
