import { describe, it, expect } from 'vitest'
import {
    buildExportJson,
    buildExportCsv,
    buildExportPdf,
} from '../services/portfolioExportService.js'
import type { Portfolio } from '../types/index.js'
import type { RebalanceEvent } from '../services/rebalanceHistory.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PORTFOLIO_ID = 'abcdef12-0000-0000-0000-000000000001'

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

const mockEventWithSpecialChars: RebalanceEvent = {
    id: 'evt-002',
    portfolioId: PORTFOLIO_ID,
    timestamp: '2024-01-16T08:00:00.000Z',
    trigger: 'Manual "override", test\nline',
    trades: 1,
    gasUsed: '0.0005',
    status: 'completed',
    isAutomatic: true,
    eventSource: 'offchain',
}

// ─── buildExportJson ─────────────────────────────────────────────────────────

describe('buildExportJson', () => {
    it('includes required GDPR meta fields', () => {
        const result = buildExportJson(mockPortfolio, [mockEvent])
        expect(result.meta.format).toBe('json')
        expect(result.meta.purpose).toBe('GDPR data export')
    })

    it('exportedAt is a valid ISO 8601 string', () => {
        const result = buildExportJson(mockPortfolio, [mockEvent])
        expect(() => new Date(result.exportedAt)).not.toThrow()
        expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('embeds the correct portfolioId', () => {
        const result = buildExportJson(mockPortfolio, [mockEvent])
        expect(result.portfolioId).toBe(PORTFOLIO_ID)
    })

    it('embeds the portfolio object by reference', () => {
        const result = buildExportJson(mockPortfolio, [mockEvent])
        expect(result.portfolio).toEqual(mockPortfolio)
    })

    it('embeds the full rebalance history array', () => {
        const result = buildExportJson(mockPortfolio, [mockEvent])
        expect(result.rebalanceHistory).toHaveLength(1)
        expect(result.rebalanceHistory[0]).toEqual(mockEvent)
    })

    it('handles empty rebalance history', () => {
        const result = buildExportJson(mockPortfolio, [])
        expect(result.rebalanceHistory).toEqual([])
        expect(result.portfolioId).toBe(PORTFOLIO_ID)
    })

    it('serialises cleanly to JSON (no circular references)', () => {
        const result = buildExportJson(mockPortfolio, [mockEvent])
        expect(() => JSON.stringify(result)).not.toThrow()
    })
})

// ─── buildExportCsv ──────────────────────────────────────────────────────────

const EXPECTED_CSV_HEADER =
    'id,portfolioId,timestamp,trigger,trades,gasUsed,status,eventSource,onChainTxHash,isAutomatic,fromAsset,toAsset,amount'

describe('buildExportCsv', () => {
    it('first line is exactly the canonical CSV header', () => {
        const csv = buildExportCsv([mockEvent])
        const firstLine = csv.split('\n')[0]
        expect(firstLine).toBe(EXPECTED_CSV_HEADER)
    })

    it('contains one data row for a single event', () => {
        const csv = buildExportCsv([mockEvent])
        const lines = csv.split('\n').filter(Boolean)
        // header + 1 data row
        expect(lines).toHaveLength(2)
    })

    it('rows map event fields in the expected column order', () => {
        const csv = buildExportCsv([mockEvent])
        const dataLine = csv.split('\n')[1]
        expect(dataLine).toContain(mockEvent.id)
        expect(dataLine).toContain(mockEvent.portfolioId)
        expect(dataLine).toContain(mockEvent.trigger)
        expect(dataLine).toContain('false') // isAutomatic
        expect(dataLine).toContain('XLM') // fromAsset
        expect(dataLine).toContain('USDC') // toAsset
    })

    it('RFC 4180: wraps cells containing commas or quotes in double-quotes', () => {
        const csv = buildExportCsv([mockEventWithSpecialChars])
        // trigger has commas and double-quotes so it must be quoted
        expect(csv).toContain('"Manual ""override"", test')
    })

    it('RFC 4180: wraps cells containing newlines in double-quotes', () => {
        const csv = buildExportCsv([mockEventWithSpecialChars])
        // The cell with \n must be inside quotes
        const afterHeader = csv.split('\n').slice(1).join('\n')
        // The opening quote for the trigger cell
        expect(afterHeader).toContain('"Manual')
    })

    it('empty history returns just the header row (no data rows)', () => {
        const csv = buildExportCsv([])
        // header + body (empty) joined with '\n', so: "header\n\n"
        // Regardless of trailing whitespace the first line must be the header
        // and there must be no non-empty data lines after it.
        const lines = csv.split('\n')
        expect(lines[0]).toBe(EXPECTED_CSV_HEADER)
        const dataLines = lines.slice(1).filter(l => l.trim().length > 0)
        expect(dataLines).toHaveLength(0)
    })

    it('handles multiple events — one row per event', () => {
        const csv = buildExportCsv([mockEvent, mockEventWithSpecialChars])
        // The CSV has embedded newlines inside a quoted cell for mockEventWithSpecialChars,
        // so splitting naively by \n gives more lines. Instead verify by checking that
        // both event IDs appear in the output.
        expect(csv).toContain(mockEvent.id)
        expect(csv).toContain(mockEventWithSpecialChars.id)
        // The output must start with the header line
        expect(csv.split('\n')[0]).toBe(EXPECTED_CSV_HEADER)
    })

    it('isAutomatic field is serialised as "true" or "false" string', () => {
        const withAuto: RebalanceEvent = { ...mockEvent, isAutomatic: true }
        const csv = buildExportCsv([withAuto])
        const dataLine = csv.split('\n')[1]
        expect(dataLine).toContain('true')
    })

    it('optional fields default to empty string when absent', () => {
        const minimal: RebalanceEvent = {
            id: 'min-evt',
            portfolioId: PORTFOLIO_ID,
            timestamp: '2024-01-01T00:00:00.000Z',
            trigger: 'Manual',
            trades: 0,
            gasUsed: '0',
            status: 'completed',
        }
        const csv = buildExportCsv([minimal])
        const dataLine = csv.split('\n')[1]
        // eventSource and onChainTxHash should be empty
        // The line should still have the right number of commas
        const cols = dataLine.split(',')
        expect(cols).toHaveLength(EXPECTED_CSV_HEADER.split(',').length)
    })
})

// ─── buildExportPdf ──────────────────────────────────────────────────────────

describe('buildExportPdf', () => {
    it('resolves to a non-empty Buffer', async () => {
        const buf = await buildExportPdf(mockPortfolio, [mockEvent])
        expect(Buffer.isBuffer(buf)).toBe(true)
        expect(buf.length).toBeGreaterThan(0)
    })

    it('buffer starts with the PDF magic bytes %PDF', async () => {
        const buf = await buildExportPdf(mockPortfolio, [mockEvent])
        expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF')
    })

    it('works with an empty rebalance history', async () => {
        const buf = await buildExportPdf(mockPortfolio, [])
        expect(Buffer.isBuffer(buf)).toBe(true)
        expect(buf.length).toBeGreaterThan(0)
    })

    it('works when optional prices map is provided', async () => {
        const prices = { XLM: { price: 0.12 }, USDC: { price: 1.0 } }
        const buf = await buildExportPdf(mockPortfolio, [mockEvent], prices)
        expect(Buffer.isBuffer(buf)).toBe(true)
        expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF')
    })
})
