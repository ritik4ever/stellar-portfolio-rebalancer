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
  // meta fields are helpful for frontend UX
  totalRows: number
  validRows: number
}

export type ParsedBulkImportResult = {
  allocations: Record<string, number>
  errors: BulkImportRowError[]
}

const MAX_ASSETS = 10

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
  }

  return { rows: [], formatError: 'JSON payload must be an array of {asset, allocation_pct} or an object with allocations: [...]' }
}

export function parseCsvText(csvText: string): { rows: AllocationInputRow[]; errors: BulkImportRowError[] } {
  // Minimal CSV parser: supports commas and newlines, with optional double-quoted fields.
  // No external deps.

  const errors: BulkImportRowError[] = []

  const trimmed = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = trimmed
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 1, field: 'csv', message: 'CSV is empty' }] }
  }

  const parseLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        const next = line[i + 1]
        // Handle escaped quote "" inside quotes
        if (inQuotes && next === '"') {
          cur += '"'
          i++
          continue
        }
        inQuotes = !inQuotes
        continue
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur.trim())
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur.trim())
    return out
  }

  const header = parseLine(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase())
  const assetIdx = header.findIndex(h => h === 'asset')
  const pctIdx = header.findIndex(h => h === 'allocation_pct')

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

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i])
    const rowNum = i + 1 // 1-based data row (including header row at 1)
    const assetRaw = cols[assetIdx]
    const pctRaw = cols[pctIdx]

    const asset = typeof assetRaw === 'string' ? normalizeAssetCode(assetRaw) : ''
    const pctStr = typeof pctRaw === 'string' ? pctRaw : ''

    const pctNum = pctStr === '' ? NaN : Number(pctStr)

    rows.push({ asset, allocation_pct: pctNum })

    if (!asset) {
      errors.push({ row: rowNum, field: 'asset', message: 'Asset is required' })
    }
    if (!Number.isFinite(pctNum)) {
      errors.push({ row: rowNum, field: 'allocation_pct', message: 'allocation_pct must be a number' })
    }
  }

  return { rows, errors }
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
    return {
      code: 'VALIDATION_ERROR',
      message: 'Bulk import validation failed',
      errors,
      totalRows: rows.length,
      validRows: rows.length - errors.length,
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
}): Promise<{ format: 'csv' | 'json'; allocations?: Record<string, number>; validationError?: BulkImportValidationError }> {
  const { body, contentType } = params
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
  const parsed = parseCsvText(csvText)
  const validated = await validateAndBuildAllocations({ rows: parsed.rows, initialRowErrors: parsed.errors })
  if ('errors' in validated) return { format, validationError: validated }
  return { format, allocations: validated.allocations }
}

