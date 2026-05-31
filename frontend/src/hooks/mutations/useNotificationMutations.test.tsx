import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../../config/api'
import {
    useSaveNotificationPreferencesMutation,
    useUnsubscribeNotificationsMutation,
    useTestNotificationMutation,
    useTestAllNotificationsMutation,
} from './useNotificationMutations'
import { notificationKeys } from '../queries/useNotificationPreferencesQuery'

function createTestClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })
}

function withClient(qc: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
}

const samplePrefs = {
    emailEnabled: false,
    emailAddress: '',
    webhookEnabled: false,
    webhookUrl: '',
    events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
}

describe('useNotificationMutations', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('invalidates notification preferences after save', async () => {
        const qc = createTestClient()
        const spy = vi.spyOn(qc, 'invalidateQueries')
        vi.spyOn(api, 'post').mockResolvedValue({ ok: true })
        const userId = 'GUSER123'

        const { result } = renderHook(() => useSaveNotificationPreferencesMutation(userId), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync(samplePrefs)
        })

        expect(spy).toHaveBeenCalledWith({ queryKey: notificationKeys.preferences(userId) })
    })

    it('invalidates notification preferences after unsubscribe', async () => {
        const qc = createTestClient()
        const spy = vi.spyOn(qc, 'invalidateQueries')
        vi.spyOn(api, 'delete').mockResolvedValue({ ok: true })
        const userId = 'GUSER456'

        const { result } = renderHook(() => useUnsubscribeNotificationsMutation(userId), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync()
        })

        expect(spy).toHaveBeenCalledWith({ queryKey: notificationKeys.preferences(userId) })
    })

    it('useTestNotificationMutation posts to the test endpoint with userId and eventType', async () => {
        const qc = createTestClient()
        const mockResponse = {
            message: 'Test sent',
            sentTo: { email: 'u@e.com', webhook: null },
            timestamp: new Date().toISOString(),
        }
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue(mockResponse as any)
        const userId = 'GTEST001'

        const { result } = renderHook(() => useTestNotificationMutation(userId), {
            wrapper: withClient(qc),
        })

        let data: any
        await act(async () => {
            data = await result.current.mutateAsync('rebalance')
        })

        expect(postSpy).toHaveBeenCalledWith(
            expect.stringContaining('notifications/test'),
            { userId, eventType: 'rebalance' }
        )
        expect(data).toEqual(mockResponse)
    })

    it('useTestNotificationMutation surfaces errors from the API', async () => {
        const qc = createTestClient()
        vi.spyOn(api, 'post').mockRejectedValue(new Error('SMTP error'))
        const userId = 'GTEST002'

        const { result } = renderHook(() => useTestNotificationMutation(userId), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync('circuitBreaker').catch(() => {})
        })

        expect(result.current.isError).toBe(true)
        expect((result.current.error as Error).message).toBe('SMTP error')
    })

    it('useTestAllNotificationsMutation posts to the test-all endpoint', async () => {
        const qc = createTestClient()
        const ts = new Date().toISOString()
        const mockResponse = {
            results: [
                { eventType: 'rebalance', success: true, sentTo: { email: 'u@e.com', webhook: null }, timestamp: ts },
            ],
        }
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue(mockResponse as any)
        const userId = 'GTEST003'

        const { result } = renderHook(() => useTestAllNotificationsMutation(userId), {
            wrapper: withClient(qc),
        })

        let data: any
        await act(async () => {
            data = await result.current.mutateAsync()
        })

        expect(postSpy).toHaveBeenCalledWith(
            expect.stringContaining('notifications/test-all'),
            { userId }
        )
        expect(data).toEqual(mockResponse)
    })
})

