import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../../config/api'
import {
    useSaveNotificationPreferencesMutation,
    useUnsubscribeNotificationsMutation,
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
})
