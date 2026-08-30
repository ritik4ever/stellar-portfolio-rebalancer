import { assetRegistryService } from './assetRegistryService.js'
import { logger } from '../utils/logger.js'

export type AllocationInputRow = {
  asset: string
  allocation_pct: number
}

export type BulkImportRowError = {
  row: number // 1-based including header? (we document: data row index)
  field: string
  message: string
}

export type BulkImportValidationError = {
  code: string
  message: string
  errors: BulkImportRowError[]
  totalRows: number
  validRows: number
  truncatedErrors?: number
}

export type ParsedBulkImportResult = {
  allocations: Record<string, number>
  errors: BulkImportRowError[]
}

const MAX_ASSETS = 10
const MAX_REPORTED_ERRORS = 100

function normalizeAssetCode(input: string): string {
  return input.trim().toUpperCase()
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function parseJsonPayload(payload: unknown): { rows: AllocationInputRow[]; formatError?: string } {
  // Accept { allocations: [...] } or bare array
  if (Array.isArray(payload)) {
    return { rows: payload as AllocationInputRow[] }
  }

  if (payload && typeof payload === 'object') {
    const obj: any = payload
    if (Array.isArray(obj.allocations)) return { rows: obj.allocations as AllocationInputRow[] }
    if (obj.allocations && typeof obj.allocations === 'object' && !Array.isArray(obj.allocations)) {
      const rows: AllocationInputRow[] = Object.entries(obj.allocations).map(([symbol, pct]) => ({
        asset: symbol,
        allocation_pct: Number(pct),
      }))
      return { rows }
    }
  }

  return { rows: [], formatError: 'JSON payload must be an array of {asset, allocation_pct} or an object with allocations: [...]' }
}

export type CsvParseOptions = {
  /** Field delimiter. Defaults to ','. */
  delimiter?: string
  /**
   * Maps a raw (lowercased, trimmed) header cell to a canonical field name
   * ('asset' | 'allocation_pct'), so CSVs don't have to use those exact
   * header names. Example: { symbol: 'asset', 'weight_pct': 'allocation_pct' }
   */
  headerMap?: Record<string, string>
}

/**
 * Single-pass, dependency-free CSV state machine.
 *
 * Processes input one character at a time and emits a complete row as soon
 * as its terminator is seen, so callers never have to materialize the whole
 * file as an array of lines before parsing can begin. `push()` accepts
 * successive chunks (e.g. from a file/network stream) and correctly resumes
 * state across chunk boundaries, including a quote or CRLF pair split
 * across two chunks.
 */
class IncrementalCsvParser {
  private readonly delimiter: string
  private field = ''
  private row: string[] = []
  private rowHasContent = false
  private inQuotes = false
  private pendingCr = false
  private pendingQuoteBoundary = false

  constructor(delimiter: string) {
    this.delimiter = delimiter
  }

  *push(chunk: string): Generator<string[]> {
    let i = 0

    if (this.pendingCr) {
      this.pendingCr = false
      if (chunk[0] === '\n') i = 1
    }

    if (this.pendingQuoteBoundary) {
      this.pendingQuoteBoundary = false
      if (chunk[0] === '"') {
        this.field += '"'
        i = 1
      } else {
        this.inQuotes = false
      }
    }

    for (; i < chunk.length; i++) {
      const ch = chunk[i]

      if (this.inQuotes) {
        if (ch === '"') {
          if (i + 1 < chunk.length) {
            if (chunk[i + 1] === '"') {
              this.field += '"'
              i++
              continue
            }
            this.inQuotes = false
            continue
          }
          // Quote is the last char of this chunk: whether it closes the
          // field or starts an escaped "" pair depends on the next chunk.
          this.pendingQuoteBoundary = true
          return
        }
        this.field += ch
        this.rowHasContent = true
        continue
      }

      if (ch === '"') {
        this.inQuotes = true
        this.rowHasContent = true
        continue
      }
      if (ch === this.delimiter) {
        this.row.push(this.field.trim())
        this.field = ''
        this.rowHasContent = true
        continue
      }
      if (ch === '\r') {
        if (i + 1 < chunk.length) {
          if (chunk[i + 1] === '\n') i++
          yield* this.endRow()
          continue
        }
        this.pendingCr = true
        yield* this.endRow()
        return
      }
      if (ch === '\n') {
        yield* this.endRow()
        continue
      }

      this.field += ch
      this.rowHasContent = true
    }
  }

  /** Flush any trailing partial row once the input is exhausted. */
  *end(): Generator<string[]> {
    if (this.rowHasContent || this.field.length > 0 || this.row.length > 0) {
      yield* this.endRow()
    }
  }

  private *endRow(): Generator<string[]> {
    // A genuinely blank line (no delimiters, no content) is skipped rather
    // than emitted as a row -- matches CRLF/LF and trailing-empty-line handling.
    if (!this.rowHasContent && this.field === '' && this.row.length === 0) {
      return
    }
    this.row.push(this.field.trim())
    const result = this.row
    this.row = []
    this.field = ''
    this.rowHasContent = false
    yield result
  }
}

function resolveHeaderIndex(header: string[], canonicalField: string, headerMap?: Record<string, string>): number {
  const direct = header.findIndex(h => h === canonicalField)
  if (direct !== -1) return direct

  if (headerMap) {
    for (const [raw, mapped] of Object.entries(headerMap)) {
      if (mapped !== canonicalField) continue
      const idx = header.findIndex(h => h === raw.toLowerCase().trim())
      if (idx !== -1) return idx
    }
  }

  return -1
}

function toAllocationRow(
  cols: string[],
  assetIdx: number,
  pctIdx: number,
  rowNum: number,
): { row: AllocationInputRow; errors: BulkImportRowError[] } {
  const errors: BulkImportRowError[] = []
  const assetRaw = cols[assetIdx]
  const pctRaw = cols[pctIdx]

  const asset = typeof assetRaw === 'string' ? normalizeAssetCode(assetRaw) : ''
  const pctStr = typeof pctRaw === 'string' ? pctRaw : ''
  const pctNum = pctStr === '' ? NaN : Number(pctStr)

  if (!asset) {
    errors.push({ row: rowNum, field: 'asset', message: 'Asset is required' })
  }
  if (!Number.isFinite(pctNum)) {
    errors.push({ row: rowNum, field: 'allocation_pct', message: 'allocation_pct must be a number' })
  }

  return { row: { asset, allocation_pct: pctNum }, errors }
}

export function parseCsvText(
  csvText: string,
  options: CsvParseOptions = {},
): { rows: AllocationInputRow[]; errors: BulkImportRowError[] } {
  const delimiter = options.delimiter ?? ','
  const parser = new IncrementalCsvParser(delimiter)

  const allRows: string[][] = []
  for (const cols of parser.push(csvText)) allRows.push(cols)
  for (const cols of parser.end()) allRows.push(cols)

  if (allRows.length === 0) {
    return { rows: [], errors: [{ row: 1, field: 'csv', message: 'CSV is empty' }] }
  }

  const header = allRows[0].map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase())
  const assetIdx = resolveHeaderIndex(header, 'asset', options.headerMap)
  const pctIdx = resolveHeaderIndex(header, 'allocation_pct', options.headerMap)

  if (assetIdx === -1 || pctIdx === -1) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          field: 'header',
          message: 'CSV header must include columns: asset, allocation_pct',
        },
      ],
    }
  }

  const rows: AllocationInputRow[] = []
  const errors: BulkImportRowError[] = []

  for (let i = 1; i < allRows.length; i++) {
    const rowNum = i + 1 // 1-based data row (including header row at 1)
    const { row, errors: rowErrors } = toAllocationRow(allRows[i], assetIdx, pctIdx, rowNum)
    rows.push(row)
    errors.push(...rowErrors)
  }

  return { rows, errors }
}

export type CsvStreamRowResult =
  | { row: AllocationInputRow; error?: undefined }
  | { row?: undefined; error: BulkImportRowError }

/**
 * Streaming counterpart to {@link parseCsvText}: consumes an (async) iterable
 * of string chunks -- e.g. a large file/upload stream -- and yields each
 * parsed row (or header error) as soon as it's available, so a caller never
 * has to hold the whole CSV in memory at once.
 */
export async function* parseCsvStream(
  source: AsyncIterable<string> | Iterable<string>,
  options: CsvParseOptions = {},
): AsyncGenerator<CsvStreamRowResult> {
  const delimiter = options.delimiter ?? ','
  const parser = new IncrementalCsvParser(delimiter)

  let header: string[] | null = null
  let assetIdx = -1
  let pctIdx = -1
  let dataRowCount = 0
  let headerErrored = false

  function* handleRow(cols: string[]): Generator<CsvStreamRowResult> {
    if (!header) {
      header = cols.map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase())
      assetIdx = resolveHeaderIndex(header, 'asset', options.headerMap)
      pctIdx = resolveHeaderIndex(header, 'allocation_pct', options.headerMap)
      if (assetIdx === -1 || pctIdx === -1) {
        headerErrored = true
        yield { error: { row: 1, field: 'header', message: 'CSV header must include columns: asset, allocation_pct' } }
      }
      return
    }
    if (headerErrored) return

    dataRowCount++
    const rowNum = dataRowCount + 1
    const { row, errors } = toAllocationRow(cols, assetIdx, pctIdx, rowNum)
    for (const error of errors) yield { error }
    yield { row }
  }

  for await (const chunk of source) {
    for (const cols of parser.push(chunk)) {
      yield* handleRow(cols)
    }
  }
  for (const cols of parser.end()) {
    yield* handleRow(cols)
  }

  if (!header) {
    yield { error: { row: 1, field: 'csv', message: 'CSV is empty' } }
  }
}

async function validateAssetCodes(assets: string[]): Promise<{ valid: Set<string>; errors: BulkImportRowError[] }> {
  // Validate against asset registry
  const valid = new Set<string>()
  const errors: BulkImportRowError[] = []

  // Asset codes in this project likely match registry symbols.
  // We'll use assetRegistryService.getBySymbol.
  for (const asset of assets) {
    const sym = normalizeAssetCode(asset)
    const rec = assetRegistryService.getBySymbol(sym)
    if (!rec) {
      errors.push({ row: 0, field: 'asset', message: `Invalid or unknown asset code: ${sym}` })
    } else if (!rec.enabled) {
      errors.push({ row: 0, field: 'asset', message: `Asset is disabled: ${sym}` })
    } else if (rec.isQuarantined) {
      errors.push({ row: 0, field: 'asset', message: `Asset is quarantined: ${sym}` })
    } else {
      valid.add(sym)
    }
  }

  return { valid, errors }
}

export async function validateAndBuildAllocations(params: {
  rows: AllocationInputRow[]
  initialRowErrors: BulkImportRowError[]
}): Promise<BulkImportValidationError | { allocations: Record<string, number> }> {
  const { rows, initialRowErrors } = params

  const errors: BulkImportRowError[] = [...initialRowErrors]

  if (rows.length === 0) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'No allocation rows provided',
      errors: [{ row: 1, field: 'csv_or_json', message: 'At least one row is required' }],
      totalRows: 0,
      validRows: 0,
    }
  }

  if (rows.length > 5000) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Too many rows',
      errors: [{ row: 1, field: 'rows', message: 'Max 5000 rows supported' }],
      totalRows: rows.length,
      validRows: 0,
    }
  }

  const map: Record<string, number> = {}
  const seenDup: Record<string, number[]> = {}

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2 // data row index in CSV; for JSON we don't have header, but we keep deterministic
    const r = rows[i]

    const asset = normalizeAssetCode(String(r.asset ?? ''))
    const pct = r.allocation_pct

    if (!asset) {
      errors.push({ row: rowNum, field: 'asset', message: 'Asset is required' })
      continue
    }
    if (!isFiniteNumber(pct)) {
      errors.push({ row: rowNum, field: 'allocation_pct', message: 'allocation_pct must be a finite number' })
      continue
    }
    if (pct < 0) {
      errors.push({ row: rowNum, field: 'allocation_pct', message: 'allocation_pct must be >= 0' })
      continue
    }
    if (pct > 100) {
      errors.push({ row: rowNum, field: 'allocation_pct', message: 'allocation_pct must be <= 100' })
      continue
    }

    if (!seenDup[asset]) seenDup[asset] = []
    seenDup[asset].push([rowNum][0])

    map[asset] = (map[asset] ?? 0) + pct
  }

  // Reduce duplicates: sum percentages for same asset.
  const distinctAssets = Object.keys(map)
  if (distinctAssets.length > MAX_ASSETS) {
    errors.push({
      row: 0,
      field: 'assets',
      message: `Max ${MAX_ASSETS} assets allowed (received ${distinctAssets.length})`,
    })
  }

  const assetValidation = await validateAssetCodes(distinctAssets)
  // If validateAssetCodes errors have row=0, attach to the first occurrence for better frontend detail.
  const firstRowForAsset = (asset: string): number => {
    // best-effort: find from first valid rows
    const idx = rows.findIndex((r) => normalizeAssetCode(String(r.asset ?? '')) === asset)
    return idx >= 0 ? idx + 2 : 0
  }
  for (const e of assetValidation.errors) {
    if (e.row === 0 && typeof e.message === 'string') {
      const m = e.message.match(/: (.+)$/)
      const sym = m?.[1]
      errors.push({ ...e, row: sym ? firstRowForAsset(sym) : 0 })
    } else {
      errors.push(e)
    }
  }

  const sum = Object.values(map).reduce((s, v) => s + v, 0)
  if (Math.abs(sum - 100) > 0.01) {
    errors.push({
      row: 0,
      field: 'allocation_pct',
      message: `Allocations must sum to 100% (received ${sum}%)`,
    })
  }

  if (errors.length > 0) {
    const truncatedCount = errors.length > MAX_REPORTED_ERRORS ? errors.length - MAX_REPORTED_ERRORS : 0
    const cappedErrors = errors.length > MAX_REPORTED_ERRORS
      ? [...errors.slice(0, MAX_REPORTED_ERRORS), { row: 0, field: 'summary', message: `+${truncatedCount} more errors` }]
      : errors
    return {
      code: 'VALIDATION_ERROR',
      message: truncatedCount > 0
        ? `Bulk import validation failed (${truncatedCount} additional errors not shown)`
        : 'Bulk import validation failed',
      errors: cappedErrors,
      totalRows: rows.length,
      validRows: rows.length - errors.length,
      truncatedErrors: truncatedCount > 0 ? truncatedCount : undefined,
    }
  }

  return { allocations: map }
}

export function guessFormat(reqBody: any, contentType?: string): 'json' | 'csv' {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('text/csv') || ct.includes('application/csv')) return 'csv'
  if (ct.includes('application/json')) return 'json'

  // If body is a string, assume CSV.
  if (typeof reqBody === 'string') return 'csv'
  return 'json'
}

export function ensureImportHasAllocationsField(json: any): void {
  // no-op, just helper
  return
}

export function coerceJsonRows(jsonRows: any[]): { rows: AllocationInputRow[]; errors: BulkImportRowError[] } {
  const errors: BulkImportRowError[] = []
  const rows: AllocationInputRow[] = []
  for (let i = 0; i < jsonRows.length; i++) {
    const r = jsonRows[i]
    const rowNum = i + 2
    const asset = typeof r?.asset === 'string' ? r.asset : ''
    const pctVal = r?.allocation_pct
    const pctNum = typeof pctVal === 'number' ? pctVal : typeof pctVal === 'string' ? Number(pctVal) : NaN
    rows.push({ asset: asset ? normalizeAssetCode(asset) : '', allocation_pct: pctNum })
    if (!asset) errors.push({ row: rowNum, field: 'asset', message: 'Asset is required' })
    if (!Number.isFinite(pctNum)) errors.push({ row: rowNum, field: 'allocation_pct', message: 'allocation_pct must be a number' })
  }
  return { rows, errors }
}

export async function buildAllocationsFromAnyPayload(params: {
  body: any
  contentType?: string
  csvOptions?: CsvParseOptions
}): Promise<{ format: 'csv' | 'json'; allocations?: Record<string, number>; validationError?: BulkImportValidationError }> {
  const { body, contentType, csvOptions } = params
  const format = guessFormat(body, contentType)

  if (format === 'json') {
    const parsed = parseJsonPayload(body)
    if (parsed.formatError) {
      return {
        format,
        validationError: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid JSON payload',
          errors: [{ row: 1, field: 'json', message: parsed.formatError }],
          totalRows: 0,
          validRows: 0,
        },
      }
    }

    const { rows, errors } = coerceJsonRows(parsed.rows as any[])
    const validated = await validateAndBuildAllocations({ rows, initialRowErrors: errors })
    if ('errors' in validated) return { format, validationError: validated }
    return { format, allocations: validated.allocations }
  }

  // CSV
  const csvText = typeof body === 'string' ? body : (body?.csvText ?? '')
  const parsed = parseCsvText(csvText, csvOptions)
  const validated = await validateAndBuildAllocations({ rows: parsed.rows, initialRowErrors: parsed.errors })
  if ('errors' in validated) return { format, validationError: validated }
  return { format, allocations: validated.allocations }
}

/**
 * Streaming counterpart to {@link buildAllocationsFromAnyPayload} for CSV
 * sources too large to buffer as a single string (e.g. a large file/upload
 * stream). Rows are validated as they're parsed; only the accumulated
 * allocation map and any errors are held in memory, not the raw file.
 */
export async function buildAllocationsFromCsvStream(
  source: AsyncIterable<string> | Iterable<string>,
  options: CsvParseOptions = {},
): Promise<{ allocations?: Record<string, number>; validationError?: BulkImportValidationError }> {
  const rows: AllocationInputRow[] = []
  const initialRowErrors: BulkImportRowError[] = []

  for await (const result of parseCsvStream(source, options)) {
    if (result.error) initialRowErrors.push(result.error)
    if (result.row) rows.push(result.row)
  }

  const validated = await validateAndBuildAllocations({ rows, initialRowErrors })
  if ('errors' in validated) return { validationError: validated }
  return { allocations: validated.allocations }
}

