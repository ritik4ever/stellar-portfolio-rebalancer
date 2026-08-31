import { useMutation } from '@tanstack/react-query'
import { API_CONFIG, ENDPOINTS } from '../../config/api'
import { getAccessToken } from '../../services/authService'

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

export type BulkImportError = Error & {
  rowErrors?: BulkImportRowError[]
  totalRows?: number
  validRows?: number
  code?: string
}

function asRowError(value: unknown): BulkImportRowError | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.message !== 'string') return null
  const rawRow = rec.row
  const row = typeof rawRow === 'number' ? rawRow : Number(rawRow ?? 0)
  const field = typeof rec.field === 'string' ? rec.field : 'unknown'
  return { row: Number.isFinite(row) ? row : 0, field, message: rec.message }
}

function extractRowErrors(source: unknown): BulkImportRowError[] {
  if (!source || typeof source !== 'object') return []
  const rec = source as Record<string, unknown>
  const errorObj = rec.error && typeof rec.error === 'object' ? (rec.error as Record<string, unknown>) : null
  const details = errorObj?.details
  const detailsObj = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : null

  const candidates = [rec.errors, details, detailsObj?.errors, errorObj?.errors]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const parsed = candidate.map(asRowError).filter((row): row is BulkImportRowError => row !== null)
    if (parsed.length > 0) return parsed
  }
  return []
}

function extractMeta(source: unknown): { totalRows?: number; validRows?: number } {
  if (!source || typeof source !== 'object') return {}
  const rec = source as Record<string, unknown>
  const meta = rec.meta && typeof rec.meta === 'object' ? (rec.meta as Record<string, unknown>) : rec
  return {
    totalRows: typeof meta.totalRows === 'number' ? meta.totalRows : undefined,
    validRows: typeof meta.validRows === 'number' ? meta.validRows : undefined,
  }
}

function extractMessage(source: unknown, fallback: string): string {
  if (!source || typeof source !== 'object') return fallback
  const rec = source as Record<string, unknown>
  if (typeof rec.message === 'string' && rec.message) return rec.message
  const errorObj = rec.error
  if (errorObj && typeof errorObj === 'object' && typeof (errorObj as { message?: unknown }).message === 'string') {
    return (errorObj as { message: string }).message
  }
  return fallback
}

/** Parse the backend bulk-import validation body (failValidation) or an API envelope. */
export function parseBulkImportFailure(body: unknown, fallbackMessage = 'Import failed'): BulkImportError {
  const err = new Error(extractMessage(body, fallbackMessage)) as BulkImportError
  const rowErrors = extractRowErrors(body)
  if (rowErrors.length > 0) err.rowErrors = rowErrors
  const meta = extractMeta(body)
  if (meta.totalRows != null) err.totalRows = meta.totalRows
  if (meta.validRows != null) err.validRows = meta.validRows
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>
    const code = rec.code ?? (rec.error && typeof rec.error === 'object' ? (rec.error as { code?: unknown }).code : rec.error)
    if (typeof code === 'string') err.code = code
  }
  return err
}

function importUrl(): string {
  const base = API_CONFIG.BASE_URL.replace(/\/$/, '')
  return `${base}${ENDPOINTS.PORTFOLIO_IMPORT}`
}

async function bulkImportRequest({ content, contentType }: BulkImportPayload): Promise<BulkImportSuccessResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': contentType,
  }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(importUrl(), {
      method: 'POST',
      headers,
      body: content,
      credentials: 'omit',
    })
  } catch (err) {
    throw err instanceof Error ? err : new Error('Import failed')
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw parseBulkImportFailure(body, `Import failed (${response.status})`)
  }

  const payload =
    body && typeof body === 'object' && 'data' in body && (body as { data?: unknown }).data != null
      ? (body as { data: BulkImportSuccessResponse }).data
      : (body as BulkImportSuccessResponse | null)

  if (!payload?.portfolioId) {
    throw new Error('Import succeeded but no portfolio id was returned')
  }

  return payload
}

export function useBulkImport() {
  const mutation = useMutation<BulkImportSuccessResponse, BulkImportError, BulkImportPayload>({
    mutationFn: bulkImportRequest,
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    rowErrors: mutation.error?.rowErrors ?? [],
    totalRows: mutation.error?.totalRows,
    validRows: mutation.error?.validRows,
  }
}
