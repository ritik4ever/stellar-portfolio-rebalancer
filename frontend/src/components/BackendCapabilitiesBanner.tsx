import { Info, AlertTriangle } from 'lucide-react'
import type { CapabilityNotice } from '../hooks/useReadinessReport'

type Props = {
    notices: CapabilityNotice[]
    loadError: boolean
    loading: boolean
    belowRealtimeBar: boolean
}

export default function BackendCapabilitiesBanner({ notices, loadError, loading, belowRealtimeBar }: Props) {
    const show = loadError || notices.length > 0
    if (!show && !loading) {
        return null
    }

    const positionClass = belowRealtimeBar ? 'top-14' : 'top-0'

    if (loadError && notices.length === 0) {
        return (
            <div
                className={`fixed left-0 right-0 z-[38] border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 ${positionClass}`}
                role="status"
                aria-live="polite"
            >
                <div className="mx-auto flex max-w-4xl items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                    <p className="leading-snug">
                        Could not load backend service status. The app will keep working; start the API or check the
                        network if features look stale.
                    </p>
                </div>
            </div>
        )
    }

    if (notices.length === 0) {
        return null
    }

    const hasLimited = notices.some((n) => n.kind === 'limited')

    return (
        <div
            className={`fixed left-0 right-0 z-[38] border-b shadow-sm ${positionClass} ${
                hasLimited
                    ? 'border-amber-200/80 bg-amber-50/95 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100'
                    : 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-900/85 dark:text-slate-100'
            }`}
            role="status"
            aria-live="polite"
        >
            <div className="mx-auto max-w-4xl px-4 py-2 text-sm">
                <p className="mb-1.5 font-medium leading-tight opacity-90">
                    {hasLimited
                        ? 'Some backend services are still starting or unavailable. Core actions usually still work; automation or live data may lag until things recover.'
                        : 'A few optional backend features are turned off for this environment. Nothing is wrong with your wallet — this is expected when Redis, workers, or certain flags are not enabled.'}
                </p>
                <ul className="space-y-1.5 leading-snug">
                    {notices.map((n) => (
                        <li key={n.id} className="flex gap-2">
                            {n.kind === 'limited' ? (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                            ) : (
                                <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                            )}
                            <span>{n.text}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}
