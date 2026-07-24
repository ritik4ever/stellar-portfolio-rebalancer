import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
    children: ReactNode
    fallbackTitle?: string
    fallbackMessage?: string
    onRetry?: () => void
}

interface State {
    hasError: boolean
    error: Error | null
}

function isProduction(): boolean {
    try {
        return import.meta.env.PROD === true || import.meta.env.MODE === 'production'
    } catch {
        return false
    }
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo.componentStack)
    }

    private handleRetry = (): void => {
        this.setState({ hasError: false, error: null })
        this.props.onRetry?.()
    }

    render(): ReactNode {
        if (!this.state.hasError) {
            return this.props.children
        }

        return (
            <div
                className="flex min-h-[300px] items-center justify-center rounded-xl border border-red-200 bg-red-50 p-8 dark:border-red-900/60 dark:bg-red-950/20"
                role="alert"
            >
                <div className="max-w-md text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-700 dark:text-red-300">
                        {this.props.fallbackTitle || 'Section Error'}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">
                        {this.props.fallbackMessage || 'Something went wrong in this section.'}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                        {isProduction()
                            ? 'An unexpected error occurred. Please try again.'
                            : this.state.error?.message || 'An unexpected error occurred.'}
                    </p>
                    <button
                        type="button"
                        onClick={this.handleRetry}
                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                        <RefreshCw className="h-4 w-4" aria-hidden />
                        Retry
                    </button>
                </div>
            </div>
        )
    }
}
