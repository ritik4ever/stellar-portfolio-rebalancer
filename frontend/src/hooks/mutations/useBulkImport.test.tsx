import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBulkImport } from './useBulkImport'
import type { BulkImportSuccessResponse, BulkImportRowError } from './useBulkImport'

const mockApiRequest = vi.hoisted(() => vi.fn())

vi.mock('../../config/api', () => ({
  apiRequest: mockApiRequest,
  ENDPOINTS: {
    PORTFOLIO_IMPORT: '/api/v1/portfolio/import',
  },
}))

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

describe('useBulkImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes success response on successful bulk import', async () => {
    const successResponse: BulkImportSuccessResponse = {
      portfolioId: 'portfolio-abc',
      status: 'created',
    }
    mockApiRequest.mockResolvedValue(successResponse)

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
  })

  it('surfaces per-row validation errors in the error object', async () => {
    const rowErrors: BulkImportRowError[] = [
      { row: 0, field: 'asset', message: 'Invalid asset symbol' },
      { row: 1, field: 'allocation_pct', message: 'Allocations must sum to 100' },
    ]
    const apiError = new Error('Import failed: validation errors') as any
    apiError.status = 400
    apiError.code = 'VALIDATION_ERROR'
    apiError.details = {
      error: 'VALIDATION_ERROR',
      message: 'Import failed: validation errors',
      errors: rowErrors,
      meta: { totalRows: 2, validRows: 0 },
    }
    mockApiRequest.mockRejectedValue(apiError)

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
    expect(result.current.error?.totalRows).toBe(2)
    expect(result.current.error?.validRows).toBe(0)
    expect(result.current.error?.message).toContain('validation errors')
  })

  it('handles generic API errors without rowErrors', async () => {
    const genericError = new Error('Network error')
    mockApiRequest.mockRejectedValue(genericError)

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
    expect(result.current.error?.message).toBe('Network error')
  })

  it('resolves after the API call completes', async () => {
    let resolvePromise: (value: BulkImportSuccessResponse) => void = () => {}
    const pendingPromise = new Promise<BulkImportSuccessResponse>((resolve) => {
      resolvePromise = resolve
    })
    mockApiRequest.mockReturnValue(pendingPromise)

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

    act(() => {
      resolvePromise({ portfolioId: 'p-1', status: 'created' })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })
})
