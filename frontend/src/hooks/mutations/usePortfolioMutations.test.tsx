import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../../config/api'
import { useCreatePortfolioMutation, useExecuteRebalanceMutation } from './usePortfolioMutations'
import { portfolioKeys } from '../queries/usePortfolioQuery'
import { historyKeys } from '../queries/useHistoryQuery'
import { analyticsKeys } from '../queries/useAnalyticsQuery'

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

describe('usePortfolioMutations', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('invalidates portfolio list after create', async () => {
        const qc = createTestClient()
        const spy = vi.spyOn(qc, 'invalidateQueries')
        vi.spyOn(api, 'post').mockResolvedValue({ portfolioId: 'p-new' })

        const { result } = renderHook(() => useCreatePortfolioMutation(), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync({ userAddress: 'GTEST', allocations: { XLM: 100 }, threshold: 5 })
        })

        expect(spy).toHaveBeenCalledWith({ queryKey: portfolioKeys.all })
    })

    it('invalidates detail, estimate, history, and analytics after rebalance', async () => {
        const qc = createTestClient()
        const spy = vi.spyOn(qc, 'invalidateQueries')
        vi.spyOn(api, 'post').mockResolvedValue({ result: { gasUsed: '1' } })
        const pid = 'portfolio-xyz'

        const { result } = renderHook(() => useExecuteRebalanceMutation(pid), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync()
        })

        await waitFor(() => {
            expect(spy).toHaveBeenCalledWith({ queryKey: portfolioKeys.detail(pid) })
            expect(spy).toHaveBeenCalledWith({
                queryKey: [...portfolioKeys.detail(pid), 'rebalance-estimate'],
            })
            expect(spy).toHaveBeenCalledWith({ queryKey: historyKeys.list(pid) })
            expect(spy).toHaveBeenCalledWith({ queryKey: analyticsKeys.portfolio(pid) })
        })
    })
})
