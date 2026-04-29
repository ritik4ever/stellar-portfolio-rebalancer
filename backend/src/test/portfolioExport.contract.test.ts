/**
 * Service-level contract tests for getPortfolioExport().
 *
 * Issue #290 — pin the export output contract (contentType, filename pattern,
 * body type) at the service layer so contributors can refactor the export
 * pipeline without silently breaking download behavior. The HTTP route is
 * covered by portfolioExport.integration.test.ts; this file isolates the
 * service so format-shape regressions surface even when the route layer is
 * mocked out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Portfolio } from '../types/index.js'
import type { RebalanceEvent } from '../services/rebalanceHistory.js'

const PORTFOLIO_ID = 'abcdef12-0000-0000-0000-000000000001'
const SAFE_ID = PORTFOLIO_ID.slice(0, 8) // 'abcdef12'

const mockPortfolio: Portfolio = {
    id: PORTFOLIO_ID,
    userAddress: 'GTEST1234567890ABCDEF',
    allocations: { XLM: 60, USDC: 40 },
    threshold: 5,
    balances: { XLM: 1000, USDC: 500 },
    totalValue: 1500,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastRebalance: '2024-01-15T12:00:00.000Z',
    version: 1,
}

const mockEvent: RebalanceEvent = {
    id: 'evt-001',
    portfolioId: PORTFOLIO_ID,
    timestamp: '2024-01-15T12:00:00.000Z',
    trigger: 'Threshold exceeded (6%)',
    trades: 2,
    gasUsed: '0.001',
    status: 'completed',
    isAutomatic: false,
    eventSource: 'offchain',
    details: { fromAsset: 'XLM', toAsset: 'USDC', amount: 100 },
}

// vi.hoisted runs before any vi.mock factory, so the spies are guaranteed to
// exist when the factories close over them — robust against import ordering.
const mocks = vi.hoisted(() => ({
    getPortfolio: vi.fn(),
    getRebalanceHistory: vi.fn(),
    getCurrentPrices: vi.fn(),
}))

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: {
        getPortfolio: mocks.getPortfolio,
    },
}))

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        getRebalanceHistory: mocks.getRebalanceHistory,
    },
}))

vi.mock('../services/reflector.js', () => {
    class ReflectorService {
        getCurrentPrices = mocks.getCurrentPrices
    }
    return { ReflectorService }
})

import { getPortfolioExport } from '../services/portfolioExportService.js'

beforeEach(() => {
    mocks.getPortfolio.mockReset().mockResolvedValue(mockPortfolio)
    mocks.getRebalanceHistory.mockReset().mockResolvedValue([mockEvent])
    mocks.getCurrentPrices
        .mockReset()
        .mockResolvedValue({ XLM: { price: 0.12 }, USDC: { price: 1.0 } })
})

// Filenames embed an ISO-ish timestamp (colons/dots replaced with dashes,
// truncated to seconds). The regex pins the shape contributors must preserve.
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/

// ─── JSON ────────────────────────────────────────────────────────────────────

describe('getPortfolioExport — JSON', () => {
    it('returns application/json content-type with utf-8 charset', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'json')
        expect(result).not.toBeNull()
        expect(result!.contentType).toBe('application/json; charset=utf-8')
    })

    it('filename matches portfolio_<8chars>_<timestamp>.json', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'json')
        expect(result!.filename).toMatch(
            new RegExp(`^portfolio_${SAFE_ID}_${TIMESTAMP_RE.source}\\.json$`)
        )
    })

    it('body is a JSON string parseable into the GDPR payload shape', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'json')
        expect(typeof result!.body).toBe('string')
        const parsed = JSON.parse(result!.body as string)
        expect(parsed.meta.format).toBe('json')
        expect(parsed.meta.purpose).toBe('GDPR data export')
        expect(parsed.portfolioId).toBe(PORTFOLIO_ID)
        expect(parsed.rebalanceHistory).toHaveLength(1)
    })

    it('body is pretty-printed (uses 2-space indent)', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'json')
        // pretty-print produces a leading "{\n  " — pin it so contributors
        // notice if they collapse to JSON.stringify(payload) without indent.
        expect(result!.body as string).toMatch(/^\{\n {2}"/)
    })
})

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('getPortfolioExport — CSV', () => {
    it('returns text/csv content-type with utf-8 charset', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'csv')
        expect(result!.contentType).toBe('text/csv; charset=utf-8')
    })

    it('filename matches portfolio_<8chars>_rebalance_history_<timestamp>.csv', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'csv')
        expect(result!.filename).toMatch(
            new RegExp(
                `^portfolio_${SAFE_ID}_rebalance_history_${TIMESTAMP_RE.source}\\.csv$`
            )
        )
    })

    it('body is a string starting with the canonical header row', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'csv')
        expect(typeof result!.body).toBe('string')
        const firstLine = (result!.body as string).split('\n')[0]
        expect(firstLine).toBe(
            'id,portfolioId,timestamp,trigger,trades,gasUsed,status,eventSource,onChainTxHash,isAutomatic,fromAsset,toAsset,amount'
        )
    })
})

// ─── PDF ─────────────────────────────────────────────────────────────────────

describe('getPortfolioExport — PDF', () => {
    it('returns application/pdf content-type (no charset)', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'pdf')
        expect(result!.contentType).toBe('application/pdf')
    })

    it('filename matches portfolio_<8chars>_report_<timestamp>.pdf', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'pdf')
        expect(result!.filename).toMatch(
            new RegExp(`^portfolio_${SAFE_ID}_report_${TIMESTAMP_RE.source}\\.pdf$`)
        )
    })

    it('body is a non-empty Buffer starting with %PDF magic bytes', async () => {
        const result = await getPortfolioExport(PORTFOLIO_ID, 'pdf')
        const body = result!.body
        expect(Buffer.isBuffer(body)).toBe(true)
        const buf = body as Buffer
        expect(buf.length).toBeGreaterThan(0)
        expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF')
    })

    it('still produces a valid PDF when the price feed throws', async () => {
        // Reflector failures must not abort the export — prices are best-effort.
        mocks.getCurrentPrices.mockRejectedValueOnce(new Error('reflector down'))
        const result = await getPortfolioExport(PORTFOLIO_ID, 'pdf')
        expect(result).not.toBeNull()
        expect((result!.body as Buffer).subarray(0, 4).toString('ascii')).toBe('%PDF')
    })
})

// ─── Missing portfolio / unsupported format ──────────────────────────────────

describe('getPortfolioExport — error paths', () => {
    it('returns null when the portfolio does not exist', async () => {
        mocks.getPortfolio.mockResolvedValueOnce(null)
        const result = await getPortfolioExport('does-not-exist', 'json')
        expect(result).toBeNull()
    })

    it('does not consult history or prices when portfolio is missing', async () => {
        mocks.getPortfolio.mockResolvedValueOnce(null)
        await getPortfolioExport('does-not-exist', 'pdf')
        expect(mocks.getRebalanceHistory).not.toHaveBeenCalled()
        expect(mocks.getCurrentPrices).not.toHaveBeenCalled()
    })

    it('returns null for an unsupported format string', async () => {
        // Casting through unknown so the test reflects what the route layer
        // would produce if the validation middleware were ever bypassed.
        const result = await getPortfolioExport(
            PORTFOLIO_ID,
            'xlsx' as unknown as 'json'
        )
        expect(result).toBeNull()
    })

    it('requests history with the documented EXPORT_HISTORY_LIMIT (10_000)', async () => {
        await getPortfolioExport(PORTFOLIO_ID, 'json')
        expect(mocks.getRebalanceHistory).toHaveBeenCalledWith(PORTFOLIO_ID, 10_000)
    })
})

// ─── Filename stability ──────────────────────────────────────────────────────

describe('getPortfolioExport — filename stability', () => {
    const formats: Array<['json' | 'csv' | 'pdf', RegExp]> = [
        ['json', /\.json$/],
        ['csv', /\.csv$/],
        ['pdf', /\.pdf$/],
    ]

    for (const [fmt, ext] of formats) {
        it(`${fmt} filename ends in the matching extension`, async () => {
            const result = await getPortfolioExport(PORTFOLIO_ID, fmt)
            expect(result!.filename).toMatch(ext)
        })

        it(`${fmt} filename embeds the first 8 chars of the portfolio id`, async () => {
            const result = await getPortfolioExport(PORTFOLIO_ID, fmt)
            expect(result!.filename).toContain(`_${SAFE_ID}_`)
        })

        it(`${fmt} filename uses dashes only — no colons or dots in the timestamp`, async () => {
            const result = await getPortfolioExport(PORTFOLIO_ID, fmt)
            // Strip the extension, then assert the remainder has no ':' or '.'
            // (colons break Windows filesystems; dots in the timestamp would
            // confuse extension sniffing).
            const stem = result!.filename.replace(/\.(json|csv|pdf)$/, '')
            expect(stem).not.toMatch(/[:.]/)
        })
    }
})
