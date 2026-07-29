import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('../observability', () => ({
    Sentry: {
        captureException: vi.fn(),
    },
}))

vi.mock('../utils/walletManager', () => ({
    walletManager: {
        getPublicKey: vi.fn(() => null),
    },
}))

import { ErrorBoundary } from './ErrorBoundary'
import { Sentry } from '../observability'

function Bomb() {
    throw new Error('Test render error')
}

function Safe() {
    return <div>Safe content</div>
}

describe('ErrorBoundary', () => {
    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
    })

    it('renders children when no error occurs', () => {
        render(
            <ErrorBoundary>
                <Safe />
            </ErrorBoundary>,
        )
        expect(screen.getByText('Safe content')).toBeInTheDocument()
    })

    it('renders fallback UI when a child throws', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>,
        )

        expect(screen.getByText(/section error/i)).toBeInTheDocument()
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

        consoleError.mockRestore()
    })

    it('reports the error to Sentry with context', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        render(
            <ErrorBoundary fallbackTitle="PortfolioSection">
                <Bomb />
            </ErrorBoundary>,
        )

        expect(Sentry.captureException).toHaveBeenCalledTimes(1)
        expect(Sentry.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.objectContaining({
                    componentStack: expect.any(String),
                    section: 'PortfolioSection',
                }),
            }),
        )

        consoleError.mockRestore()
    })

    it('resets error state on retry', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const onRetry = vi.fn()

        const { rerender } = render(
            <ErrorBoundary key="first" onRetry={onRetry}>
                <Bomb />
            </ErrorBoundary>,
        )

        expect(screen.getByText(/section error/i)).toBeInTheDocument()

        rerender(
            <ErrorBoundary key="second" onRetry={onRetry}>
                <Safe />
            </ErrorBoundary>,
        )

        expect(screen.getByText('Safe content')).toBeInTheDocument()

        consoleError.mockRestore()
    })

    it('calls onRetry when retry button is clicked', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const onRetry = vi.fn()

        render(
            <ErrorBoundary onRetry={onRetry}>
                <Bomb />
            </ErrorBoundary>,
        )

        const retryButton = screen.getByRole('button', { name: /retry/i })
        retryButton.click()

        expect(onRetry).toHaveBeenCalledTimes(1)

        consoleError.mockRestore()
    })
})
