import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('../observability', () => ({
    Sentry: {
        captureException: vi.fn(),
    },
}))

import { AppErrorBoundary } from './AppErrorBoundary'
import { Sentry } from '../observability'

function Bomb() {
    throw new Error('Test error')
}

function Safe() {
    return <div>Safe content</div>
}

describe('AppErrorBoundary', () => {
    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
    })

    it('renders fallback UI when a child throws', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        render(
            <AppErrorBoundary>
                <Bomb />
            </AppErrorBoundary>,
        )

        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
        expect(screen.getByText(/application error/i)).toBeInTheDocument()

        consoleError.mockRestore()
    })

    it('captures the thrown error through Sentry', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        render(
            <AppErrorBoundary>
                <Bomb />
            </AppErrorBoundary>,
        )

        expect(Sentry.captureException).toHaveBeenCalledTimes(1)
        expect(Sentry.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.objectContaining({
                    componentStack: expect.any(String),
                }),
            }),
        )

        consoleError.mockRestore()
    })

    it('resets when re-mounted and returns to the normal component tree', () => {
        const { rerender } = render(
            <AppErrorBoundary key="first">
                <Bomb />
            </AppErrorBoundary>,
        )

        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()

        rerender(
            <AppErrorBoundary key="second">
                <Safe />
            </AppErrorBoundary>,
        )

        expect(screen.getByText(/safe content/i)).toBeInTheDocument()
    })

    it('does not catch errors thrown during its own fallback render', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        class CrashingFallbackBoundary extends AppErrorBoundary {
            render() {
                if (this.state.hasError) {
                    throw new Error('Fallback render failed')
                }

                return super.render()
            }
        }

        expect(() =>
            render(
                <CrashingFallbackBoundary>
                    <Bomb />
                </CrashingFallbackBoundary>,
            ),
        ).toThrow('Fallback render failed')

        consoleError.mockRestore()
    })
})
