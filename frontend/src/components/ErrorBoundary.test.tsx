import { render, screen, cleanup } from '@testing-library/react'

const captureException = vi.fn()
const getAppVersion = vi.fn(() => 'test-release')
const sanitizeError = vi.fn((error: Error) => error)
const sanitizeObservabilityText = vi.fn((value: string) => value)

vi.mock('../observability', () => ({
    Sentry: { captureException },
    getAppVersion,
    sanitizeError,
    sanitizeObservabilityText,
}))

const getPublicKey = vi.fn(() => null)
vi.mock('../utils/walletManager', () => ({
    walletManager: { getPublicKey },
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
        window.history.replaceState({}, '', '/')
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

    it('reports the error to Sentry with safe context when a child throws', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        getPublicKey.mockReturnValue('GABC123')
        window.history.replaceState({}, '', '/portfolio?token=must-not-be-reported#private-key')

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
                    route: '/portfolio',
                    userId: 'GABC123',
                    appVersion: 'test-release',
                    section: 'PortfolioSection',
                }),
            }),
        )
        expect(JSON.stringify(Sentry.captureException.mock.calls[0])).not.toContain('must-not-be-reported')

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
