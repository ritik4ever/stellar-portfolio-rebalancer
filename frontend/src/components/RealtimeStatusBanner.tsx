import { useRealtimeConnection } from '../context/RealtimeConnectionContext'
import { Loader2, WifiOff, Radio } from 'lucide-react'

export default function RealtimeStatusBanner() {
    const { state, statusDetail, reconnect } = useRealtimeConnection()

    if (state === 'connected') {
        return (
            <div
                className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200"
                role="status"
                aria-live="polite"
                title="Backend WebSocket is connected; live push updates are active when the server sends them."
            >
                <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Live updates</span>
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
            : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100'

    return (
        <div
            className={`fixed top-0 left-0 right-0 z-40 border-b px-4 py-2 text-sm shadow-sm ${barClass}`}
            role="alert"
            aria-live="assertive"
        >
            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2 sm:justify-between">
                <div className="flex items-center gap-2">
                    {state === 'disconnected' ? (
                        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    )}
                    <span className="font-medium">{label}</span>
                    {statusDetail ? (
                        <span className="text-xs opacity-90">— {statusDetail}</span>
                    ) : null}
                </div>
                {state === 'disconnected' ? (
                    <button
                        type="button"
                        onClick={() => reconnect()}
                        className="rounded-md bg-white/80 px-3 py-1 text-xs font-medium text-red-900 ring-1 ring-red-200 hover:bg-white dark:bg-red-900/40 dark:text-red-50 dark:ring-red-700"
                    >
                        Retry connection
                    </button>
                ) : null}
            </div>
        </div>
    )
}
