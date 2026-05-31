import { useRealtimeConnection } from '../context/RealtimeConnectionContext'
import { useReadinessReport } from '../hooks/useReadinessReport'
import { Loader2, WifiOff, Radio } from 'lucide-react'
import ReadinessDrilldown from './ReadinessDrilldown'

export default function RealtimeStatusBanner() {
    const { state, statusDetail, reconnect } = useRealtimeConnection()
    const { report, loading: readinessLoading, loadError: readinessError } = useReadinessReport()

    const showDrilldown = readinessLoading || readinessError || report?.status === 'not_ready'

    if (state === 'connected') {
        return (
            <div
                className="fixed top-3 right-3 z-40 rounded-2xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 shadow-sm dark:border-green-800 dark:bg-green-950/60 dark:text-green-200"
                role="status"
                aria-live="polite"
                title="Backend WebSocket is connected; live push updates are active when the server sends them."
            >
                <div className="flex items-center gap-1.5">
                    <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="font-medium">Live updates</span>
                </div>
                {showDrilldown && (
                    <ReadinessDrilldown
                        report={report}
                        loading={readinessLoading}
                        loadError={readinessError}
                    />
                )}
            </div>
        )
    }

    const label =
        state === 'connecting'
            ? 'Connecting to live updates…'
            : state === 'reconnecting'
              ? 'Reconnecting to live updates…'
              : 'Live updates disconnected'

    const barClass =
        state === 'disconnected'
            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100'
            : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/55 dark:text-amber-100'

    return (
        <div
            className={`fixed top-3 right-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-2xl border px-3 py-2 text-sm shadow-lg backdrop-blur ${barClass}`}
            role="alert"
            aria-live="assertive"
        >
            <div className="flex items-center gap-2">
                {state === 'disconnected' ? (
                    <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                )}
                <div className="min-w-0">
                    <div className="truncate font-medium">{label}</div>
                    {statusDetail ? (
                        <div className="truncate text-[11px] opacity-85">{statusDetail}</div>
                    ) : null}
                </div>
                {state === 'disconnected' ? (
                    <button
                        type="button"
                        onClick={() => reconnect()}
                        className="ml-1 rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-red-900 ring-1 ring-red-200 hover:bg-white dark:bg-red-900/40 dark:text-red-50 dark:ring-red-700"
                    >
                        Retry connection
                    </button>
                ) : null}
            </div>
            {showDrilldown && (
                <ReadinessDrilldown
                    report={report}
                    loading={readinessLoading}
                    loadError={readinessError}
                />
            )}
        </div>
    )
}
