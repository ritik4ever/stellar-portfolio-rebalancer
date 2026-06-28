import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import type { BootCheck } from '../app/walletBoot'

interface BootDiagnosticsPanelProps {
    checks: BootCheck[]
    onRetry?: () => void
    className?: string
}

function StatusIcon({ status }: { status: BootCheck['status'] }) {
    switch (status) {
        case 'loading':
            return <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" aria-hidden />
        case 'passed':
            return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" aria-hidden />
        case 'failed':
            return <XCircle className="h-4 w-4 text-red-500 shrink-0" aria-hidden />
    }
}

const statusLabel: Record<BootCheck['status'], string> = {
    loading: 'Checking…',
    passed: 'Passed',
    failed: 'Failed',
}

export default function BootDiagnosticsPanel({ checks, onRetry, className = '' }: BootDiagnosticsPanelProps) {
    const hasFailed = checks.some((c) => c.status === 'failed')
    const isLoading = checks.some((c) => c.status === 'loading')

    if (checks.length === 0 && !isLoading) {
        return null
    }

    return (
        <div
            className={`rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/60 ${className}`}
            role="status"
            aria-live="polite"
            aria-label="Boot diagnostics"
        >
            <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Startup checks
                </span>
                {isLoading ? (
                    <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        Running…
                    </span>
                ) : null}
            </div>

            <ul className="space-y-1.5">
                {checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2">
                        <StatusIcon status={check.status} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5">
                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                    {check.label}
                                </span>
                                <span className={`text-[11px] ${check.status === 'passed' ? 'text-green-600 dark:text-green-400' : check.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-slate-400 dark:text-slate-500'}`}>
                                    {statusLabel[check.status]}
                                </span>
                            </div>
                            {check.message ? (
                                <p className="text-xs leading-snug text-slate-500 dark:text-slate-400">
                                    {check.message}
                                </p>
                            ) : null}
                        </div>
                    </li>
                ))}
            </ul>

            {hasFailed && onRetry ? (
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={isLoading}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
                    Retry checks
                </button>
            ) : null}
        </div>
    )
}
