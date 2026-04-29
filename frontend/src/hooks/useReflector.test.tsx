import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import {
    useReflector,
    PRICE_STALENESS_THRESHOLD_MS,
    REFLECTOR_POLL_INTERVAL_MS,
} from './useReflector'
import { api, ENDPOINTS } from '../config/api'

function TestComponent() {
    const { prices, loading, error, isStale } = useReflector()
    return (
        <div>
            <div data-testid="loading">{String(loading)}</div>
            <div data-testid="error">{error ?? ''}</div>
            <div data-testid="price">{prices.XLM?.price ?? ''}</div>
            <div data-testid="stale">{String(isStale)}</div>
        </div>
    )
}

describe('useReflector', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('loads prices', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ XLM: { price: 0.1, change: 1, timestamp: Date.now() } }),
        } as Response)

        render(<TestComponent />)

        await waitFor(() => expect(screen.getByTestId('price').textContent).toBe('0.1'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
        expect(screen.getByTestId('error').textContent).toBe('')
        expect(screen.getByTestId('stale').textContent).toBe('false')
    })

    it('marks prices stale at threshold boundary', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                XLM: { price: 0.1, change: 0, timestamp: Date.now() - (PRICE_STALENESS_THRESHOLD_MS - 1000) },
            }),
        } as Response)

        const first = render(<TestComponent />)
        await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('false'))
        first.unmount()

        vi.restoreAllMocks()
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                XLM: { price: 0.1, change: 0, timestamp: Date.now() - (PRICE_STALENESS_THRESHOLD_MS + 1000) },
            }),
        } as Response)
        render(<TestComponent />)
        await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('true'))
    })

    it('polls at expected interval', async () => {
        vi.useFakeTimers()
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ XLM: { price: 0.1, change: 1, timestamp: Date.now() } }),
        } as Response)

        render(<TestComponent />)
        await act(async () => {
            await Promise.resolve()
        })
        expect(fetchSpy).toHaveBeenCalledTimes(1)

        await act(async () => {
            vi.advanceTimersByTime(REFLECTOR_POLL_INTERVAL_MS)
            await Promise.resolve()
        })
        expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('falls back to backend API when reflector is unreachable', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('reflector down'))
        const apiGetSpy = vi
            .spyOn(api, 'get')
            .mockResolvedValue({ XLM: { price: 0.23, change: 1, timestamp: Date.now() } } as any)

        render(<TestComponent />)
        await waitFor(() => expect(screen.getByTestId('price').textContent).toBe('0.23'))
        expect(apiGetSpy).toHaveBeenCalledWith(ENDPOINTS.PRICES)
    })

    it('cancels in-flight request on unmount', async () => {
        const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            () => new Promise(() => undefined) as Promise<Response>
        )

        const view = render(<TestComponent />)
        view.unmount()
        expect(abortSpy).toHaveBeenCalled()
    })
})
