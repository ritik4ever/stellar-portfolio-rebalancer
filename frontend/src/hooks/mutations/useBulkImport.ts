import { useMutation } from '@tanstack/react-query'
import { apiRequest, ENDPOINTS } from '../../config/api'
import type { ApiClientError } from '../../config/api'

export type BulkImportRowError = {
  row: number
  field: string
  message: string
}

export type BulkImportValidationError = {
  error: 'VALIDATION_ERROR' | string
  message?: string
  code?: string
  errors?: BulkImportRowError[]
  meta?: {
    totalRows?: number
    validRows?: number
  }
}

export type BulkImportSuccessResponse = {
  portfolioId: string
  status: 'created'
}

export type BulkImportPayload = {
  content: string
  contentType: 'application/json' | 'text/csv'
}

export function useBulkImport() {
  return useMutation<
    BulkImportSuccessResponse,
    Error & { rowErrors?: BulkImportRowError[]; totalRows?: number; validRows?: number },
    BulkImportPayload
  >({
    mutationFn: async ({ content, contentType }) => {
      try {
        const data = await apiRequest<BulkImportSuccessResponse>(
          ENDPOINTS.PORTFOLIO_IMPORT,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': contentType,
            },
            body: content,
          },
        )
        return data
      } catch (err: unknown) {
        const apiErr = err as ApiClientError
        if (apiErr.details) {
          const validation = apiErr.details as BulkImportValidationError
          const combined = new Error(
            validation.message || apiErr.message || 'Import failed',
          ) as Error & {
            rowErrors?: BulkImportRowError[]
            totalRows?: number
            validRows?: number
          }
          combined.rowErrors = validation.errors
          combined.totalRows = validation.meta?.totalRows
          combined.validRows = validation.meta?.validRows
          throw combined
        }
        throw err
      }
    },
  })
}
