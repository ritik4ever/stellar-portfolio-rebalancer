import { describe, expect, it } from 'vitest'
import { buildCapabilityNotices, type ReadinessReport } from './useReadinessReport'

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
