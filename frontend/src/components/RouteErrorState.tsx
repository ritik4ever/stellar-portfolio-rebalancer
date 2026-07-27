import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react'

type Props = {
    title: string
    message: string
    detail?: string
    onRetry: () => void
    onBack?: () => void
    retryLabel?: string
    backLabel?: string
    loading?: boolean
}

export default function RouteErrorState({
    title,
    message,
    detail,
    onRetry,
    onBack,
    retryLabel = 'Retry',
    backLabel = 'Back',
    loading = false,
}: Props) {
    return (
        <div className="min-h-[70vh] bg-gray-50 px-6 py-16 dark:bg-gray-900">
            <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 rounded-3xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-900/60 dark:bg-gray-800">
                <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-red-100 p-3 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                        <AlertTriangle className="h-6 w-6" aria-hidden />
                    </div>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-700 dark:text-red-300">
                            Route error
                        </p>
                        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{title}</h1>
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">{message}</p>
                    {detail ? (
                        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{detail}</p>
                    ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={onRetry}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                        {loading ? 'Retrying…' : retryLabel}
                    </button>
                    {onBack ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                            <ArrowLeft className="h-4 w-4" aria-hidden />
                            {backLabel}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
