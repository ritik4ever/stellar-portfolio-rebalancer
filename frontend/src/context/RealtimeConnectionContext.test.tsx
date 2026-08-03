import { renderHook, act } from '@testing-library/react'
import {
    RealtimeConnectionProvider,
    useRealtimeConnection,
} from './RealtimeConnectionContext'
import { RebalancerWSClient } from '../services/websocket.client'
import React from 'react'
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'

vi.mock('../services/websocket.client')

describe('RealtimeConnectionContext', () => {
    let mockClient: any
    let mockSetState: any
    let mockOnMessage: any

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()

        ;(RebalancerWSClient as Mock).mockImplementation(function(this: any, _url: any, options: any) {
            mockSetState = options.onStateChange
            mockOnMessage = options.onMessage
            mockClient = {
                connect: vi.fn(),
                disconnect: vi.fn(),
                send: vi.fn(),
                setPaused: vi.fn(),
                resume: vi.fn(),
            }
            return mockClient
        })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <RealtimeConnectionProvider>{children}</RealtimeConnectionProvider>
    )

    it('classifies quality correctly based on latency and disconnects', () => {
        const { result } = renderHook(() => useRealtimeConnection(), { wrapper })

        // Initial state
        expect(result.current.quality).toBe('unknown')

        // Connect
        act(() => {
            mockSetState('connected')
        })
        expect(result.current.quality).toBe('good')

        // Simulate good latency
        act(() => {
            mockOnMessage({ type: 'PONG', timestamp: Date.now() - 50 })
        })
        expect(result.current.quality).toBe('good')

        // Simulate degraded latency
        act(() => {
            mockOnMessage({ type: 'PONG', timestamp: Date.now() - 250 })
        })
        expect(result.current.quality).toBe('degraded')

        // Simulate poor latency
        act(() => {
            mockOnMessage({ type: 'PONG', timestamp: Date.now() - 550 })
        })
        expect(result.current.quality).toBe('poor')

        // Simulate back to good latency
        act(() => {
            mockOnMessage({ type: 'PONG', timestamp: Date.now() - 50 })
        })
        expect(result.current.quality).toBe('good')

        // Simulate multiple disconnects to trigger poor quality
        act(() => {
            mockSetState('disconnected')
        })
        expect(result.current.quality).toBe('unknown')

        act(() => {
            mockSetState('connected')
        })

        act(() => {
            mockSetState('disconnected')
        })
        expect(result.current.quality).toBe('unknown')

        act(() => {
            mockSetState('connected')
        })
        expect(result.current.quality).toBe('poor') // Due to 2 recent disconnects
    })
})
