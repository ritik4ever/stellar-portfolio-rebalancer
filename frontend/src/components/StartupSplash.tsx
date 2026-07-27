import { Loader2 } from 'lucide-react'

type StartupSplashProps = {
    loading: boolean
    loadError: boolean
}

export default function StartupSplash({ loading, loadError }: StartupSplashProps) {
    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-50 dark:bg-gray-900"
            role="status"
            aria-live="polite"
            aria-busy={loading}
        >
            <div className="mx-4 max-w-sm text-center">
                <Loader2
                    className={`mx-auto h-12 w-12 text-blue-600 dark:text-blue-400 ${loading ? 'animate-spin' : ''}`}
                    aria-hidden
                />
                <h1 className="mt-6 text-lg font-semibold text-gray-900 dark:text-white">
                    Stellar Portfolio Rebalancer
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {loading
                        ? 'Checking backend health before opening your dashboard…'
                        : loadError
                          ? 'Backend health check finished with warnings. You can continue with limited features.'
                          : 'Starting…'}
                </p>
            </div>
        </div>
    )
}
