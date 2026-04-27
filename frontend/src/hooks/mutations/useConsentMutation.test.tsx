import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../../config/api'
import { useRecordConsentMutation, consentKeys } from './useConsentMutation'

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

describe('useRecordConsentMutation', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('invalidates consent status query after recording consent', async () => {
        const qc = createTestClient()
        const spy = vi.spyOn(qc, 'invalidateQueries')
        vi.spyOn(api, 'post').mockResolvedValue({ recorded: true })
        const userId = 'GCONSENT1'

        const { result } = renderHook(() => useRecordConsentMutation(userId), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync()
        })

        expect(spy).toHaveBeenCalledWith({ queryKey: consentKeys.status(userId) })
    })
})
