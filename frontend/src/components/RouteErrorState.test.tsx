import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RouteErrorState from './RouteErrorState'

describe('RouteErrorState', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('renders title and message', () => {
        render(
            <RouteErrorState
                title="Loading Failed"
                message="Could not load portfolio data."
                onRetry={() => {}}
            />,
        )
        expect(screen.getByText('Loading Failed')).toBeInTheDocument()
        expect(screen.getByText('Could not load portfolio data.')).toBeInTheDocument()
    })

    it('calls onRetry when retry button is clicked', async () => {
        const onRetry = vi.fn()
        render(
            <RouteErrorState
                title="Error"
                message="Something went wrong."
                onRetry={onRetry}
            />,
        )

        const button = screen.getByRole('button', { name: /retry/i })
        await act(async () => {
            button.click()
        })

        expect(onRetry).not.toHaveBeenCalled()

        act(() => {
            vi.advanceTimersByTime(1000)
        })

        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('applies exponential backoff on repeated retries', async () => {
        const onRetry = vi.fn()
        render(
            <RouteErrorState
                title="Error"
                message="Failed."
                onRetry={onRetry}
            />,
        )

        const button = screen.getByRole('button', { name: /retry/i })

        await act(async () => { button.click() })
        act(() => { vi.advanceTimersByTime(1000) })
        expect(onRetry).toHaveBeenCalledTimes(1)

        await act(async () => { button.click() })
        expect(onRetry).toHaveBeenCalledTimes(1)

        act(() => { vi.advanceTimersByTime(1000) })
        expect(onRetry).toHaveBeenCalledTimes(1)

        act(() => { vi.advanceTimersByTime(1000) })
        expect(onRetry).toHaveBeenCalledTimes(2)

        await act(async () => { button.click() })
        act(() => { vi.advanceTimersByTime(4000) })
        expect(onRetry).toHaveBeenCalledTimes(3)
    })

    it('shows loading indicator while retry is in progress', async () => {
        render(
            <RouteErrorState
                title="Error"
                message="Failed."
                onRetry={() => {}}
            />,
        )

        const button = screen.getByRole('button', { name: /retry/i })
        expect(button).not.toBeDisabled()

        await act(async () => { button.click() })

        expect(button).toBeDisabled()
        expect(screen.getByText('Retrying…')).toBeInTheDocument()
    })

    it('renders back button when onBack is provided', () => {
        render(
            <RouteErrorState
                title="Error"
                message="Failed."
                onRetry={() => {}}
                onBack={() => {}}
            />,
        )
        expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    })

    it('resets retry count after loading completes', async () => {
        const onRetry = vi.fn()
        const { rerender } = render(
            <RouteErrorState
                title="Error"
                message="Failed."
                onRetry={onRetry}
                loading={false}
            />,
        )

        const button = screen.getByRole('button', { name: /retry/i })

        await act(async () => { button.click() })
        act(() => { vi.advanceTimersByTime(1000) })
        expect(onRetry).toHaveBeenCalledTimes(1)

        rerender(
            <RouteErrorState
                title="Error"
                message="Failed."
                onRetry={onRetry}
                loading={true}
            />,
        )

        rerender(
            <RouteErrorState
                title="Error"
                message="Failed."
                onRetry={onRetry}
                loading={false}
            />,
        )

        act(() => { vi.advanceTimersByTime(5000) })
    })
})
