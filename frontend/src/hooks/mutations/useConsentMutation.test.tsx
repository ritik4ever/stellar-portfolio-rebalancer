import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../../config/api'
import {
    useRecordConsentMutation,
    useRevokeConsentMutation,
    consentKeys,
} from './useConsentMutation'

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

    it('optimistically sets consent to granted on mutate start', async () => {
        const qc = createTestClient()
        const userId = 'GCONSENT2'
        qc.setQueryData(consentKeys.status(userId), { accepted: false })

        let resolveRequest!: (value: unknown) => void
        vi.spyOn(api, 'post').mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve
                }) as Promise<any>,
        )

        const { result } = renderHook(() => useRecordConsentMutation(userId), {
            wrapper: withClient(qc),
        })

        act(() => {
            result.current.mutate()
        })

        await vi.waitFor(() => {
            expect(qc.getQueryData<{ accepted: boolean }>(consentKeys.status(userId))).toEqual({
                accepted: true,
            })
        })

        await act(async () => {
            resolveRequest({ recorded: true })
        })
    })

    it('rolls back optimistic grant when mutation fails', async () => {
        const qc = createTestClient()
        const userId = 'GCONSENT3'
        qc.setQueryData(consentKeys.status(userId), { accepted: false })
        vi.spyOn(api, 'post').mockRejectedValue(new Error('network down'))

        const { result } = renderHook(() => useRecordConsentMutation(userId), {
            wrapper: withClient(qc),
        })

        let err: any;
        await act(async () => {
            try {
                await result.current.mutateAsync()
            } catch (e) {
                err = e;
            }
        })
        expect(err?.message).toMatch(/network down/i)
        expect(qc.getQueryData(consentKeys.status(userId))).toEqual({ accepted: false })
    })

    it('keeps optimistic success stable without flicker or double-update', async () => {
        const qc = createTestClient()
        const userId = 'GCONSENT4'
        qc.setQueryData(consentKeys.status(userId), { accepted: false })
        vi.spyOn(api, 'post').mockResolvedValue({ recorded: true })

        const timeline: boolean[] = []
        const unsubscribe = qc.getQueryCache().subscribe((event) => {
            const key = event.query.queryKey
            if (JSON.stringify(key) !== JSON.stringify(consentKeys.status(userId))) return
            const current = qc.getQueryData<{ accepted: boolean }>(consentKeys.status(userId))
            if (typeof current?.accepted === 'boolean') {
                timeline.push(current.accepted)
            }
        })

        const { result } = renderHook(() => useRecordConsentMutation(userId), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync()
        })
        unsubscribe()

        expect(qc.getQueryData(consentKeys.status(userId))).toEqual({ accepted: true })
        expect(timeline).toContain(true)
        expect(timeline).not.toContain(false)
    })
})

describe('useRevokeConsentMutation', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('optimistically sets consent to revoked and rolls back on failure', async () => {
        const qc = createTestClient()
        const userId = 'GCONSENT5'
        qc.setQueryData(consentKeys.status(userId), { accepted: true })
        vi.spyOn(api, 'delete').mockRejectedValue(new Error('delete failed'))

        const { result } = renderHook(() => useRevokeConsentMutation(userId), {
            wrapper: withClient(qc),
        })

        let err: any;
        await act(async () => {
            try {
                await result.current.mutateAsync()
            } catch (e) {
                err = e;
            }
        })
        expect(err?.message).toMatch(/delete failed/i)
        expect(qc.getQueryData(consentKeys.status(userId))).toEqual({ accepted: true })
    })

    it('keeps optimistic revoke stable on success without flicker', async () => {
        const qc = createTestClient()
        const userId = 'GCONSENT6'
        qc.setQueryData(consentKeys.status(userId), { accepted: true })
        vi.spyOn(api, 'delete').mockResolvedValue({ ok: true })

        const timeline: boolean[] = []
        const unsubscribe = qc.getQueryCache().subscribe((event) => {
            const key = event.query.queryKey
            if (JSON.stringify(key) !== JSON.stringify(consentKeys.status(userId))) return
            const current = qc.getQueryData<{ accepted: boolean }>(consentKeys.status(userId))
            if (typeof current?.accepted === 'boolean') {
                timeline.push(current.accepted)
            }
        })

        const { result } = renderHook(() => useRevokeConsentMutation(userId), {
            wrapper: withClient(qc),
        })

        await act(async () => {
            await result.current.mutateAsync()
        })
        unsubscribe()

        expect(qc.getQueryData(consentKeys.status(userId))).toEqual({ accepted: false })
        expect(timeline).toContain(false)
        expect(timeline).not.toContain(true)
    })
})
