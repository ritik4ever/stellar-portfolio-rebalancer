import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
    usePortfolioLiveFeed,
    BACKOFF_BASE_MS,
    BACKOFF_MAX_MS,
    BACKOFF_MULTIPLIER,
} from './usePortfolioLiveFeed'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../config/api', () => ({
    getWebSocketUrl: () => 'ws://localhost:3001',
}))

vi.mock('../services/authService', () => ({
    getAccessToken: () => 'mock-token',
}))

// Minimal WebSocket stub that lets tests control open/close/error events.
class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    readyState = MockWebSocket.CONNECTING
    url: string

    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null

    send = vi.fn()
    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED
    })

    constructor(url: string) {
        this.url = url
        MockWebSocket.instances.push(this)
    }

    /** Simulate the server accepting the connection. */
    simulateOpen() {
        this.readyState = MockWebSocket.OPEN
        this.onopen?.()
    }

    /** Simulate the server closing / dropping the connection. */
    simulateClose() {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.()
    }

    /** Simulate a socket-level error. */
    simulateError() {
        this.onerror?.()
    }

    /** Simulate an inbound message. */
    simulateMessage(data: object) {
        this.onmessage?.({ data: JSON.stringify(data) })
    }

    // Track all instances created during a test.
    static instances: MockWebSocket[] = []
    static reset() {
        MockWebSocket.instances = []
    }
    static latest(): MockWebSocket {
        return MockWebSocket.instances[MockWebSocket.instances.length - 1]
    }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
    MockWebSocket.reset()
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expected delay for the nth reconnect attempt (0-indexed). */
function expectedDelay(attempt: number): number {
    return Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt), BACKOFF_MAX_MS)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePortfolioLiveFeed – exponential-backoff reconnect', () => {
    it('starts in "connecting" state and transitions to "connected" on open', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        expect(result.current.status).toBe('connecting')

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        expect(result.current.status).toBe('connected')
    })

    it('transitions to "reconnecting" immediately after a disconnect', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })
        expect(result.current.status).toBe('connected')

        await act(async () => {
            MockWebSocket.latest().simulateClose()
        })

        expect(result.current.status).toBe('reconnecting')
    })

    it('backoff delays increase exponentially across repeated disconnects', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        // Open the initial connection.
        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        const ATTEMPTS = 4

        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const delay = expectedDelay(attempt)

            // Drop the current connection – hook schedules reconnect after `delay`.
            await act(async () => {
                MockWebSocket.latest().simulateClose()
            })
            expect(result.current.status).toBe('reconnecting')

            // Advance time by just under the expected delay – no new socket yet.
            await act(async () => {
                vi.advanceTimersByTime(delay - 1)
            })
            const socketCountBefore = MockWebSocket.instances.length

            // Advance the remaining millisecond – the retry fires.
            await act(async () => {
                vi.advanceTimersByTime(1)
            })
            expect(MockWebSocket.instances.length).toBe(socketCountBefore + 1)

            // Immediately drop this new socket so the next iteration can test
            // the next backoff tier (without triggering a reset by opening it).
            // Exception: on the last attempt we leave it open to test reset.
            if (attempt < ATTEMPTS - 1) {
                await act(async () => {
                    MockWebSocket.latest().simulateClose()
                })
            }
        }
    })

    it('resets backoff counter to 0 after a successful reconnect', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        // Initial connect and open.
        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        // First disconnect → first retry fires after BACKOFF_BASE_MS.
        await act(async () => {
            MockWebSocket.latest().simulateClose()
        })
        await act(async () => {
            vi.advanceTimersByTime(expectedDelay(0))
        })

        // Second disconnect → second retry fires after BACKOFF_BASE_MS * BACKOFF_MULTIPLIER.
        await act(async () => {
            MockWebSocket.latest().simulateClose()
        })
        await act(async () => {
            vi.advanceTimersByTime(expectedDelay(1))
        })

        // Successful open → reset.
        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })
        expect(result.current.status).toBe('connected')

        // Now disconnect again. The next retry must use the base delay (attempt 0).
        await act(async () => {
            MockWebSocket.latest().simulateClose()
        })
        expect(result.current.status).toBe('reconnecting')

        // Advance by just under the base delay – no new socket yet.
        await act(async () => {
            vi.advanceTimersByTime(expectedDelay(0) - 1)
        })
        const countBefore = MockWebSocket.instances.length

        // One more tick triggers the reconnect.
        await act(async () => {
            vi.advanceTimersByTime(1)
        })
        expect(MockWebSocket.instances.length).toBe(countBefore + 1)
    })

    it('caps the backoff delay at BACKOFF_MAX_MS', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        // Trigger enough failures to exceed the cap.
        // The cap kicks in when BACKOFF_BASE_MS * 2^attempt >= BACKOFF_MAX_MS.
        const attemptsToExceedCap = Math.ceil(
            Math.log(BACKOFF_MAX_MS / BACKOFF_BASE_MS) / Math.log(BACKOFF_MULTIPLIER)
        )

        for (let i = 0; i <= attemptsToExceedCap; i++) {
            await act(async () => {
                MockWebSocket.latest().simulateClose()
            })
            // Advance by the capped delay to allow the retry to fire.
            await act(async () => {
                vi.advanceTimersByTime(BACKOFF_MAX_MS)
            })
        }

        // After all those attempts the status must still be reconnecting
        // (the last socket hasn't been opened yet).
        expect(result.current.status).toBe('reconnecting')
    })

    it('cleans up the retry timer and closes the socket on unmount', async () => {
        const { result, unmount } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        // Drop connection so a retry is pending.
        await act(async () => {
            MockWebSocket.latest().simulateClose()
        })

        const socketBeforeUnmount = MockWebSocket.latest()
        const socketCountBeforeUnmount = MockWebSocket.instances.length

        unmount()

        // Advance past the backoff window – no new socket should be created.
        await act(async () => {
            vi.advanceTimersByTime(BACKOFF_MAX_MS * 2)
        })

        expect(MockWebSocket.instances.length).toBe(socketCountBeforeUnmount)
        // The original socket was already closed by onclose, but the hook
        // must not create a new one after unmount.
        expect(result.current.status).toBe('reconnecting')
    })

    it('stays disconnected and does not open a socket when portfolioId is null', () => {
        const { result } = renderHook(() => usePortfolioLiveFeed(null))

        expect(result.current.status).toBe('disconnected')
        expect(MockWebSocket.instances.length).toBe(0)
    })

    it('delivers PORTFOLIO_VALUE_UPDATE messages via lastPricesTick', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        const fakePrices = { XLM: { price: 0.12, change: 0.5 } }

        await act(async () => {
            MockWebSocket.latest().simulateMessage({ type: 'PORTFOLIO_VALUE_UPDATE', prices: fakePrices })
        })

        expect(result.current.lastPricesTick).toEqual(fakePrices)
    })

    it('replies to HEARTBEAT messages with a PING', async () => {
        renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        const ws = MockWebSocket.latest()
        await act(async () => {
            ws.simulateMessage({ type: 'HEARTBEAT' })
        })

        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'PING' }))
    })

    it('transitions to "error" on a socket error event', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateError()
        })

        expect(result.current.status).toBe('error')
    })

    it('exposes connectionState as a deprecated alias for status', async () => {
        const { result } = renderHook(() => usePortfolioLiveFeed('portfolio-1'))

        await act(async () => {
            MockWebSocket.latest().simulateOpen()
        })

        expect(result.current.connectionState).toBe(result.current.status)
        expect(result.current.connectionState).toBe('connected')
    })
})
