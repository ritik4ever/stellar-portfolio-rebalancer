import { describe, it, expect, vi } from 'vitest'
import {
  parseCsvText,
  validateAndBuildAllocations,
  coerceJsonRows,
} from '../services/portfolioImportService.js'

vi.mock('../services/assetRegistryService.js', () => ({
  assetRegistryService: {
    getBySymbol: (sym: string) => {
      const registry: Record<string, { enabled: boolean; isQuarantined: boolean }> = {
        XLM: { enabled: true, isQuarantined: false },
        USDC: { enabled: true, isQuarantined: false },
        BTC: { enabled: true, isQuarantined: false },
        ETH: { enabled: true, isQuarantined: false },
      }
      return registry[sym] ?? null
    },
  },
}))

describe('portfolioImportService - structured error array', () => {
  it('returns all row-level errors for mixed valid/invalid CSV rows', async () => {
    const csv = [
      'asset,allocation_pct',
      'XLM,30',
      'BAD1,20',
      'USDC,25',
      ',10',
      'BTC,abc',
      'ETH,15',
    ].join('\n')

    const parsed = parseCsvText(csv)
    const result = await validateAndBuildAllocations({
      rows: parsed.rows,
      initialRowErrors: parsed.errors,
    })

    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      const rowErrors = result.errors.filter((e) => e.row >= 2)
      expect(rowErrors.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('continues validating remaining rows after one row fails', async () => {
    const rows = [
      { asset: 'XLM', allocation_pct: 50 },
      { asset: '', allocation_pct: 20 },
      { asset: 'USDC', allocation_pct: 30 },
    ]

    const { rows: parsedRows, errors: initialErrors } = {
      rows,
      errors: [] as any[],
    }

    const result = await validateAndBuildAllocations({
      rows: parsedRows,
      initialRowErrors: initialErrors,
    })

    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      const assetErrors = result.errors.filter(
        (e) => e.field === 'asset' && e.row === 3,
      )
      expect(assetErrors.length).toBeGreaterThan(0)
    }
  })

  it('caps reported errors at 100 with +N more summary', async () => {
    const rows: { asset: string; allocation_pct: number }[] = []
    for (let i = 0; i < 150; i++) {
      rows.push({ asset: '', allocation_pct: NaN })
    }

    const result = await validateAndBuildAllocations({
      rows,
      initialRowErrors: [],
    })

    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors.length).toBeLessThanOrEqual(102)
      const summaryError = result.errors.find((e) => e.field === 'summary')
      expect(summaryError).toBeDefined()
      expect(summaryError!.message).toMatch(/\+\d+ more/)
      expect(result.truncatedErrors).toBeDefined()
      expect(result.truncatedErrors).toBeGreaterThan(0)
    }
  })

  it('returns valid allocations when all rows are correct', async () => {
    const rows = [
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ]

    const result = await validateAndBuildAllocations({
      rows,
      initialRowErrors: [],
    })

    expect('allocations' in result).toBe(true)
    if ('allocations' in result) {
      expect(result.allocations.XLM).toBe(60)
      expect(result.allocations.USDC).toBe(40)
    }
  })

  it('coerceJsonRows collects errors for bad rows without stopping', () => {
    const jsonRows = [
      { asset: 'XLM', allocation_pct: 50 },
      { asset: '', allocation_pct: 20 },
      { asset: 'USDC', allocation_pct: 'bad' },
      { asset: 'BTC', allocation_pct: 30 },
    ]

    const { errors } = coerceJsonRows(jsonRows)
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })
})
