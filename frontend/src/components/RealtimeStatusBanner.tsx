import { useRealtimeConnection } from '../context/RealtimeConnectionContext'
import { Loader2, WifiOff, Radio, HelpCircle, RotateCcw } from 'lucide-react'
import { useState } from 'react'

export default function RealtimeStatusBanner() {
    const { state, statusDetail, reconnect } = useRealtimeConnection()
    const [showDiagnostics, setShowDiagnostics] = useState(false)

    if (state === 'connected') {
        return (
            <div
                className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-800 shadow-sm dark:border-green-800 dark:bg-green-950/60 dark:text-green-200"
                role="status"
                aria-live="polite"
                title="Backend WebSocket is connected; live push updates are active when the server sends them."
            >
                <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="font-medium">Live updates</span>
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

    const buttonClass =
        state === 'disconnected'
            ? 'bg-white/85 text-red-900 ring-red-200 dark:bg-red-900/40 dark:text-red-50 dark:ring-red-700'
            : 'bg-white/85 text-amber-900 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-50 dark:ring-amber-700'

    return (
        <div
            className={`fixed top-3 right-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${barClass}`}
            role="alert"
            aria-live="assertive"
        >
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    {state === 'disconnected' ? (
                        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{label}</div>
                        {statusDetail ? (
                            <div className="truncate text-[11px] opacity-85">{statusDetail}</div>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {state === 'disconnected' && (
                            <button
                                type="button"
                                onClick={() => reconnect()}
                                className={`rounded-md px-2 py-1 text-xs font-medium ring-1 hover:bg-white dark:hover:bg-opacity-10 transition-colors ${buttonClass}`}
                                title="Attempt to reconnect to live updates"
                                aria-label="Retry connection"
                            >
                                <RotateCcw className="h-3.5 w-3.5 inline mr-1" aria-hidden />
                                Retry
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowDiagnostics(!showDiagnostics)}
                            className={`rounded-md px-2 py-1 text-xs font-medium ring-1 hover:bg-white dark:hover:bg-opacity-10 transition-colors ${buttonClass}`}
                            title="Show connection diagnostics"
                            aria-label="Show diagnostics"
                            aria-expanded={showDiagnostics}
                        >
                            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
                        </button>
                    </div>
                </div>

                {showDiagnostics && (
                    <div className="rounded-md bg-black/10 p-2 text-[10px] font-mono dark:bg-white/10">
                        <div className="space-y-1">
                            <div>
                                <span className="font-semibold">Status:</span> {state}
                            </div>
                            <div>
                                <span className="font-semibold">WebSocket:</span>{' '}
                                {typeof WebSocket !== 'undefined' ? 'Available' : 'Unavailable'}
                            </div>
                            {statusDetail && (
                                <div>
                                    <span className="font-semibold">Detail:</span> {statusDetail}
                                </div>
                            )}
                            <div>
                                <span className="font-semibold">Timestamp:</span>{' '}
                                {new Date().toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
