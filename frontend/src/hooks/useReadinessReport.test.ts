import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { buildCapabilityNotices, useReadinessReport, type ReadinessReport } from './useReadinessReport'

function baseReport(over: Partial<ReadinessReport['checks']> = {}): ReadinessReport {
    const ready = { status: 'ready' as const, required: true, message: 'ok' }
    const disabled = { status: 'disabled' as const, required: false, message: 'off' }
    return {
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
            database: over.database ?? ready,
            queue: over.queue ?? ready,
            workers: over.workers ?? ready,
            contractEventIndexer: over.contractEventIndexer ?? disabled,
            autoRebalancer: over.autoRebalancer ?? disabled,
        },
    }
}

describe('buildCapabilityNotices', () => {
    it('merges queue and workers when both disabled', () => {
        const disabled = { status: 'disabled' as const, required: false, message: 'off' }
        const r = baseReport({ queue: disabled, workers: disabled })
        const ids = buildCapabilityNotices(r).map((n) => n.id)
        expect(ids).toContain('queue-workers')
        expect(ids).not.toContain('queue')
        expect(ids).not.toContain('workers')
    })

    it('labels indexer disabled as intentional', () => {
        const r = baseReport({
            contractEventIndexer: { status: 'disabled', required: false, message: 'Contract event indexer is disabled' },
        })
        const n = buildCapabilityNotices(r).find((x) => x.id === 'indexer')
        expect(n?.kind).toBe('disabled')
        expect(n?.text).toMatch(/by configuration/i)
    })

    it('labels indexer not_ready as data lag', () => {
        const r = baseReport({
            contractEventIndexer: {
                status: 'not_ready',
                required: true,
                message: 'sync pending',
            },
        })
        const n = buildCapabilityNotices(r).find((x) => x.id === 'indexer')
        expect(n?.kind).toBe('limited')
        expect(n?.text).toMatch(/startup sync/i)
    })

    it('labels auto-rebalancer disabled separately from not_ready', () => {
        const off = baseReport({
            autoRebalancer: { status: 'disabled', required: false, message: 'off' },
        })
        expect(buildCapabilityNotices(off).find((x) => x.id === 'auto-rebalancer')?.kind).toBe('disabled')

        const bad = baseReport({
            autoRebalancer: { status: 'not_ready', required: true, message: 'broken' },
        })
        expect(buildCapabilityNotices(bad).find((x) => x.id === 'auto-rebalancer')?.kind).toBe('limited')
    })
})

describe('useReadinessReport hook', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn())
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('maps "ready" status correctly', async () => {
        const mockReport = baseReport()
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => mockReport,
        } as any)

        const { result } = renderHook(() => useReadinessReport())

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.report?.status).toBe('ready')
        expect(result.current.loadError).toBe(false)
        expect(result.current.notices).toHaveLength(0)
    })

    it('maps degraded services to warning notices', async () => {
        const mockReport = baseReport({
            database: { status: 'not_ready', required: true, message: 'db down' }
        })
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => mockReport,
        } as any)

        const { result } = renderHook(() => useReadinessReport())

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.notices.some(n => n.id === 'database' && n.kind === 'limited')).toBe(true)
    })

    it('produces an error state on network failure', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network Error'))

        const { result } = renderHook(() => useReadinessReport())

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.loadError).toBe(true)
        expect(result.current.report).toBeNull()
    })

    it('re-fetches on the auto-refresh interval', async () => {
        const mockReport = baseReport()
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => mockReport,
        } as any)

        renderHook(() => useReadinessReport())

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

        // Advance time by POLL_MS (45s)
        act(() => {
            vi.advanceTimersByTime(45000)
        })

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    })
})
