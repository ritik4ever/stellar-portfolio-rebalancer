import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { parseBulkImportFailure, useBulkImport } from './useBulkImport'
import type { BulkImportSuccessResponse, BulkImportRowError } from './useBulkImport'

vi.mock('../../config/api', () => ({
  ENDPOINTS: {
    PORTFOLIO_IMPORT: '/api/v1/portfolio/import',
  },
  API_CONFIG: {
    BASE_URL: 'http://localhost:3001',
  },
}))

vi.mock('../../services/authService', () => ({
  getAccessToken: () => null,
}))

function jsonResponse(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

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

describe('parseBulkImportFailure', () => {
  it('reads the backend failValidation body (top-level errors + meta)', () => {
    const parsed = parseBulkImportFailure({
      error: 'VALIDATION_ERROR',
      message: 'Import failed: validation errors',
      code: 'VALIDATION_ERROR',
      errors: [{ row: 1, field: 'asset', message: 'Unknown asset' }],
      meta: { totalRows: 2, validRows: 1 },
    })

    expect(parsed.message).toContain('validation errors')
    expect(parsed.rowErrors).toEqual([{ row: 1, field: 'asset', message: 'Unknown asset' }])
    expect(parsed.totalRows).toBe(2)
    expect(parsed.validRows).toBe(1)
  })
})

describe('useBulkImport', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes success response on successful bulk import', async () => {
    const successResponse: BulkImportSuccessResponse = {
      portfolioId: 'portfolio-abc',
      status: 'created',
    }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: successResponse }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const qc = createTestClient()
    const { result } = renderHook(() => useBulkImport(), {
      wrapper: withClient(qc),
    })

    const csvContent = 'asset,allocation_pct\nXLM,50\nUSDC,50\n'

    result.current.mutate({
      content: csvContent,
      contentType: 'text/csv',
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual(successResponse)
    expect(result.current.isError).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.rowErrors).toEqual([])
  })

  it('surfaces per-row validation errors from the backend failValidation format', async () => {
    const rowErrors: BulkImportRowError[] = [
      { row: 0, field: 'asset', message: 'Invalid asset symbol' },
      { row: 1, field: 'allocation_pct', message: 'Allocations must sum to 100' },
    ]
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: 'VALIDATION_ERROR',
        message: 'Import failed: validation errors',
        code: 'VALIDATION_ERROR',
        errors: rowErrors,
        meta: { totalRows: 2, validRows: 0 },
      }),
    )

    const qc = createTestClient()
    const { result } = renderHook(() => useBulkImport(), {
      wrapper: withClient(qc),
    })

    const jsonContent = JSON.stringify([
      { asset: 'INVALID', allocation_pct: 60 },
      { asset: 'XLM', allocation_pct: 50 },
    ])

    result.current.mutate({
      content: jsonContent,
      contentType: 'application/json',
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.rowErrors).toEqual(rowErrors)
    expect(result.current.rowErrors).toEqual(rowErrors)
    expect(result.current.totalRows).toBe(2)
    expect(result.current.validRows).toBe(0)
    expect(result.current.error?.message).toContain('validation errors')
  })

  it('handles generic API errors without rowErrors', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'))

    const qc = createTestClient()
    const { result } = renderHook(() => useBulkImport(), {
      wrapper: withClient(qc),
    })

    result.current.mutate({
      content: 'bad data',
      contentType: 'application/json',
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.rowErrors).toBeUndefined()
    expect(result.current.rowErrors).toEqual([])
    expect(result.current.error?.message).toBe('Network error')
  })

  it('exposes loading state while the request is in flight', async () => {
    let resolvePromise: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePromise = resolve
      }),
    )

    const qc = createTestClient()
    const { result } = renderHook(() => useBulkImport(), {
      wrapper: withClient(qc),
    })

    act(() => {
      result.current.mutate({
        content: 'XLM,50\nUSDC,50\n',
        contentType: 'text/csv',
      })
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true)
    })

    act(() => {
      resolvePromise(
        new Response(JSON.stringify({ portfolioId: 'p-1', status: 'created' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.isLoading).toBe(false)
  })
})
