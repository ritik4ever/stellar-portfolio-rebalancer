import { Info, AlertTriangle, ExternalLink } from 'lucide-react'
import type { CapabilityNotice } from '../hooks/useReadinessReport'

type Props = {
    notices: CapabilityNotice[]
    loadError: boolean
    loading: boolean
    belowRealtimeBar: boolean
}

interface NoticeHint {
    label: string
    href: string
}

const NOTICE_HINTS: Record<string, NoticeHint> = {
    database: {
        label: 'Database setup',
        href: 'https://github.com/ritik4ever/stellar-portfolio-rebalancer#database-setup',
    },
    'queue-workers': {
        label: 'Redis / worker setup',
        href: 'https://github.com/ritik4ever/stellar-portfolio-rebalancer/blob/main/docs/CONTRIBUTING.md',
    },
    queue: {
        label: 'Redis / worker setup',
        href: 'https://github.com/ritik4ever/stellar-portfolio-rebalancer/blob/main/docs/CONTRIBUTING.md',
    },
    workers: {
        label: 'Redis / worker setup',
        href: 'https://github.com/ritik4ever/stellar-portfolio-rebalancer/blob/main/docs/CONTRIBUTING.md',
    },
    indexer: {
        label: 'Environment setup',
        href: 'https://github.com/ritik4ever/stellar-portfolio-rebalancer/blob/main/docs/ENVIRONMENT.md',
    },
    'auto-rebalancer': {
        label: 'Environment setup',
        href: 'https://github.com/ritik4ever/stellar-portfolio-rebalancer/blob/main/docs/ENVIRONMENT.md',
    },
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
                    {notices.map((n) => {
                        const hint = NOTICE_HINTS[n.id]
                        return (
                            <li key={n.id} className="flex gap-2">
                                {n.kind === 'limited' ? (
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                                ) : (
                                    <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
                                )}
                                <span>
                                    {n.text}
                                    {hint && (
                                        <>
                                            {' '}
                                            <a
                                                href={hint.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
                                            >
                                                {hint.label}
                                                <ExternalLink className="h-3 w-3" aria-hidden />
                                            </a>
                                        </>
                                    )}
                                </span>
                            </li>
                        )
                    })}
                </ul>
            </div>
        </div>
    )
}
