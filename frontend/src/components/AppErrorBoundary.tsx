import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Sentry } from '../observability'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
}

export class AppErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError(): State {
        return { hasError: true }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        Sentry.captureException(error, {
            extra: {
                componentStack: errorInfo.componentStack,
            },
        })
    }

    render(): ReactNode {
        if (!this.state.hasError) {
            return this.props.children
        }

        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
                <div className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
                    <p className="text-xs uppercase tracking-[0.3em] text-amber-300">Application Error</p>
                    <h1 className="mt-3 text-3xl font-semibold">Something went wrong.</h1>
                    <p className="mt-4 text-sm leading-6 text-slate-300">
                        The error has been reported. Refresh the page to retry, and if the problem continues check the backend health and observability dashboards.
                    </p>
                </div>
            </div>
        )
    }
}
