import { useRealtimeConnection } from '../context/RealtimeConnectionContext'


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
              ? reconnectInfo
                  ? `Reconnecting (${reconnectInfo.attempt}/${reconnectInfo.maxAttempts})…`
                  : 'Reconnecting to live updates…'
              : state === 'paused'
                ? 'Live updates paused'
                : 'Live updates disconnected'

    const barClass =
        state === 'disconnected'
            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100'
            : state === 'paused'
              ? 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100'
              : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/55 dark:text-amber-100'

    const retrySeconds =
        reconnectInfo?.nextRetryMs != null
            ? Math.max(1, Math.round(reconnectInfo.nextRetryMs / 1000))
            : null

    const buttonClass =
        state === 'disconnected'
            ? 'bg-white/85 text-red-900 ring-red-200 dark:bg-red-900/40 dark:text-red-50 dark:ring-red-700'
            : 'bg-white/85 text-amber-900 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-50 dark:ring-amber-700'

    return (
        <div

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
