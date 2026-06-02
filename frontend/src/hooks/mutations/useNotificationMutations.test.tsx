import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../../config/api'
import {
    getNotificationMutationError,
    getNotificationMutationMicrostate,
    useSaveNotificationPreferencesMutation,
    useSendAllTestNotificationsMutation,
    useSendTestNotificationMutation,
    useUnsubscribeNotificationsMutation,
} from './useNotificationMutations'
import { notificationKeys } from '../queries/useNotificationPreferencesQuery'
import { ENDPOINTS } from '../../config/api'

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
    digestEnabled: false,
    digestFrequency: 'realtime',
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

    it('derives descriptive pending and error microstates', () => {
        expect(getNotificationMutationError(new Error('SMTP unavailable'))).toBe('SMTP unavailable')

        expect(
            getNotificationMutationMicrostate(
                { status: 'pending', error: null },
                {
                    idle: 'Ready',
                    pending: 'Saving notification preferences',
                    success: 'Saved',
                    error: 'Could not save notification preferences',
                }
            )
        ).toEqual({
            phase: 'pending',
            label: 'Saving notification preferences',
            description: 'Saving notification preferences',
            errorMessage: undefined,
        })

        expect(
            getNotificationMutationMicrostate(
                { status: 'error', error: new Error('Network failed') },
                {
                    idle: 'Ready',
                    pending: 'Saving',
                    success: 'Saved',
                    error: 'Could not save notification preferences',
                }
            )
        ).toMatchObject({
            phase: 'error',
            label: 'Could not save notification preferences',
            description: 'Could not save notification preferences: Network failed',
            errorMessage: 'Network failed',
        })
    })

    it('sends an individual test notification through the mutation hook', async () => {
        const qc = createTestClient()
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
            message: 'Sent',
            sentTo: { email: 'user@example.com', webhook: null },
            timestamp: '2026-06-01T00:00:00.000Z',
        })

        const { result } = renderHook(() => useSendTestNotificationMutation(), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync({ userId: 'user-1', eventType: 'rebalance' })
        })

        expect(postSpy).toHaveBeenCalledWith(ENDPOINTS.NOTIFICATIONS_TEST, {
            userId: 'user-1',
            eventType: 'rebalance',
        })
    })

    it('sends all test notifications through the mutation hook', async () => {
        const qc = createTestClient()
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ results: [] })

        const { result } = renderHook(() => useSendAllTestNotificationsMutation(), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync('user-1')
        })

        expect(postSpy).toHaveBeenCalledWith(ENDPOINTS.NOTIFICATIONS_TEST_ALL, { userId: 'user-1' })
    })
})
