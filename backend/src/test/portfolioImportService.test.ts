import { describe, it, expect, vi } from 'vitest'
import {
  parseCsvText,
  parseCsvStream,
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

describe('parseCsvText - dependency-free parser edge cases', () => {
  it('parses quoted fields containing embedded commas', () => {
    const csv = 'asset,allocation_pct\n"XLM, primary",60\nUSDC,40'
    const { rows, errors } = parseCsvText(csv)
    expect(errors.length).toBe(0)
    expect(rows[0].asset).toBe('XLM, PRIMARY')
    expect(rows[1].asset).toBe('USDC')
  })

  it('handles escaped double-quotes ("") inside quoted fields', () => {
    const csv = 'asset,allocation_pct\n"XL""M",60\nUSDC,40'
    const { rows, errors } = parseCsvText(csv)
    expect(errors.length).toBe(0)
    expect(rows[0].asset).toBe('XL"M')
  })

  it('handles CRLF line endings identically to LF', () => {
    const csv = 'asset,allocation_pct\r\nXLM,60\r\nUSDC,40\r\n'
    const { rows, errors } = parseCsvText(csv)
    expect(errors.length).toBe(0)
    expect(rows).toEqual([
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ])
  })

  it('skips trailing and embedded blank lines without producing phantom rows', () => {
    const csv = 'asset,allocation_pct\n\nXLM,60\n\nUSDC,40\n\n\n'
    const { rows, errors } = parseCsvText(csv)
    expect(errors.length).toBe(0)
    expect(rows).toEqual([
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ])
  })

  it('reports a row-level error for a malformed (non-numeric) allocation_pct', () => {
    const csv = 'asset,allocation_pct\nXLM,sixty\nUSDC,40'
    const { rows, errors } = parseCsvText(csv)
    expect(rows[0].allocation_pct).toBeNaN()
    expect(errors.some(e => e.field === 'allocation_pct' && e.row === 2)).toBe(true)
  })

  it('reports a row-level error for a missing asset column value', () => {
    const csv = 'asset,allocation_pct\n,60\nUSDC,40'
    const { errors } = parseCsvText(csv)
    expect(errors.some(e => e.field === 'asset' && e.row === 2)).toBe(true)
  })

  it('supports a configurable delimiter', () => {
    const csv = 'asset;allocation_pct\nXLM;60\nUSDC;40'
    const { rows, errors } = parseCsvText(csv, { delimiter: ';' })
    expect(errors.length).toBe(0)
    expect(rows).toEqual([
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ])
  })

  it('supports header-row mapping to canonical field names', () => {
    const csv = 'symbol,weight_pct\nXLM,60\nUSDC,40'
    const { rows, errors } = parseCsvText(csv, {
      headerMap: { symbol: 'asset', weight_pct: 'allocation_pct' },
    })
    expect(errors.length).toBe(0)
    expect(rows).toEqual([
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ])
  })

  it('rejects a header missing required columns', () => {
    const csv = 'foo,bar\nXLM,60'
    const { rows, errors } = parseCsvText(csv)
    expect(rows).toEqual([])
    expect(errors[0].field).toBe('header')
  })

  it('treats an empty CSV as an error', () => {
    const { rows, errors } = parseCsvText('')
    expect(rows).toEqual([])
    expect(errors[0].field).toBe('csv')
  })
})

describe('parseCsvStream - chunked streaming parser', () => {
  async function collect(chunks: string[], options?: Parameters<typeof parseCsvStream>[1]) {
    const rows: { asset: string; allocation_pct: number }[] = []
    const errors: string[] = []
    async function* gen() {
      for (const c of chunks) yield c
    }
    for await (const result of parseCsvStream(gen(), options)) {
      if (result.row) rows.push(result.row)
      if (result.error) errors.push(result.error.field)
    }
    return { rows, errors }
  }

  it('parses a CSV delivered as many small chunks, split mid-field', async () => {
    const chunks = ['as', 'set,all', 'ocation_pct\nXL', 'M,6', '0\nUSD', 'C,40']
    const { rows, errors } = await collect(chunks)
    expect(errors.length).toBe(0)
    expect(rows).toEqual([
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ])
  })

  it('correctly resolves an escaped quote pair split across a chunk boundary', async () => {
    // "XL""M" split right between the two quote characters of the pair
    const chunks = ['asset,allocation_pct\n"XL"', '"M",60']
    const { rows, errors } = await collect(chunks)
    expect(errors.length).toBe(0)
    expect(rows[0].asset).toBe('XL"M')
  })

  it('correctly resolves a CRLF terminator split across a chunk boundary', async () => {
    const chunks = ['asset,allocation_pct\r', '\nXLM,60\r', '\nUSDC,40']
    const { rows, errors } = await collect(chunks)
    expect(errors.length).toBe(0)
    expect(rows).toEqual([
      { asset: 'XLM', allocation_pct: 60 },
      { asset: 'USDC', allocation_pct: 40 },
    ])
  })

  it('yields a header error for a stream missing required columns', async () => {
    const { rows, errors } = await collect(['foo,bar\n', 'XLM,60'])
    expect(rows.length).toBe(0)
    expect(errors).toContain('header')
  })
})
