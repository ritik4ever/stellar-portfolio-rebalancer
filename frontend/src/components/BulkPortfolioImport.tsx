import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useBulkImport,
  type BulkImportRowError,
} from '../hooks/mutations/useBulkImport'

type ParsedRow = {
  asset: string
  allocation_pct: string
}

type RowStatus = 'pending' | 'error' | 'corrected' | 'success'

type EditableRow = {
  original: ParsedRow
  current: ParsedRow
  status: RowStatus
  errors: BulkImportRowError[]
}

type SuccessSummary = {
  portfolioId: string
}

function detectLikelyJson(file: File): boolean {
  const name = file.name.toLowerCase()
  return file.type.includes('json') || name.endsWith('.json')
}

function detectLikelyCsv(file: File): boolean {
  const name = file.name.toLowerCase()
  return file.type.includes('csv') || name.endsWith('.csv')
}

function parseCsvRows(text: string): ParsedRow[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const assetIdx = header.indexOf('asset')
  const allocIdx = header.indexOf('allocation_pct')
  if (assetIdx === -1 || allocIdx === -1) return []
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim())
    return { asset: cols[assetIdx] ?? '', allocation_pct: cols[allocIdx] ?? '' }
  })
}

function parseJsonRows(text: string): ParsedRow[] {
  try {
    const parsed = JSON.parse(text)
    const arr = Array.isArray(parsed) ? parsed : parsed.rows ?? parsed.data ?? [parsed]
    return arr.map((item: Record<string, unknown>) => ({
      asset: String(item.asset ?? ''),
      allocation_pct: String(item.allocation_pct ?? item.allocation ?? '')
    }))
  } catch {
    return []
  }
}

function getRowErrors(rowErrors: BulkImportRowError[], rowIdx: number): BulkImportRowError[] {
  return rowErrors.filter(e => e.row === rowIdx || e.row === rowIdx + 1)
}

function getErrorForField(errors: BulkImportRowError[], field: string): string | undefined {
  return errors.find(e => e.field === field)?.message
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsText(file)
  })
}

export default function BulkPortfolioImport(props: {
  userAddressForDemo?: string | null
  onImported?: (portfolioId: string) => void
}): JSX.Element {
  const { onImported } = props

  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<BulkImportRowError[]>([])
  const [meta, setMeta] = useState<{ totalRows?: number; validRows?: number } | null>(null)
  const [success, setSuccess] = useState<SuccessSummary | null>(null)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [editableRows, setEditableRows] = useState<EditableRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)
  const progressTimerRef = useRef<number | null>(null)

  const mutation = useBulkImport()

  const importMode = useMemo(() => {
    if (!file) return 'unknown'
    if (detectLikelyJson(file)) return 'json'
    if (detectLikelyCsv(file)) return 'csv'
    return file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'
  }, [file])

  const hasCorrectedRows = useMemo(
    () => editableRows.some(r => r.status === 'corrected'),
    [editableRows]
  )

  useEffect(() => {
    return () => {
      if (progressTimerRef.current != null) {
        window.clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
    }
  }, [])

  const startProgress = () => {
    setProgress(5)
    progressTimerRef.current = window.setInterval(() => {
      setProgress(p => (p < 90 ? Math.min(90, p + 8 + Math.random() * 10) : p))
    }, 200)
  }

  const stopProgress = (final: number) => {
    if (progressTimerRef.current != null) {
      window.clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
    setProgress(final)
  }

  const resetImportState = () => {
    setSubmitError(null)
    setRowErrors([])
    setMeta(null)
    setSuccess(null)
    setEditableRows([])
  }

  const applyFile = (picked: File | null) => {
    resetImportState()
    setFile(picked)

    if (!picked) {
      setPreview(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setPreview(text.slice(0, 2048))
    }
    reader.readAsText(picked)
  }

  const handlePickFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    applyFile(e.target.files?.[0] ?? null)
    e.target.value = ''
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    setDragActive(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setDragActive(false)

    const dropped = e.dataTransfer.files?.[0] ?? null
    if (dropped) applyFile(dropped)
  }

  const handleImport = async () => {
    if (!file) {
      setSubmitError('Choose a CSV or JSON file first')
      return
    }

    resetImportState()
    setSuccess(null)
    setProgress(0)
    startProgress()

    const likelyJson = detectLikelyJson(file) || importMode === 'json'

    try {
      const text = await readFileText(file)

      const result = await mutation.mutateAsync({
        content: text,
        contentType: likelyJson ? 'application/json' : 'text/csv',
      })

      stopProgress(100)
      setSuccess({ portfolioId: result.portfolioId })
      if (onImported) onImported(result.portfolioId)
    } catch (err: unknown) {
      stopProgress(0)
      const importError = err as Error & {
        rowErrors?: BulkImportRowError[]
        totalRows?: number
        validRows?: number
      }
      const errors = importError.rowErrors ?? []
      setRowErrors(errors)
      if (importError.totalRows != null) {
        setMeta({ totalRows: importError.totalRows, validRows: importError.validRows ?? 0 })
      }
      setSubmitError(importError.message || 'Import failed')

      if (errors.length > 0) {
        let text = ''
        try {
          text = await readFileText(file)
        } catch {
          text = ''
        }
        const parsed = likelyJson ? parseJsonRows(text) : parseCsvRows(text)
        setEditableRows(parsed.map((row, idx) => ({
          original: { ...row },
          current: { ...row },
          status: getRowErrors(errors, idx).length > 0 ? 'error' : 'pending',
          errors: getRowErrors(errors, idx)
        })))
      }
    }
  }

  const handleCellEdit = (rowIdx: number, field: 'asset' | 'allocation_pct', value: string) => {
    setEditableRows(prev => prev.map((row, idx) => {
      if (idx !== rowIdx) return row
      const updated = { ...row.current, [field]: value }
      const fieldErrors = row.errors.filter(e => e.field !== field)
      return {
        ...row,
        current: updated,
        status: 'corrected' as RowStatus,
        errors: fieldErrors
      }
    }))
  }

  const handleRetryCorrected = async () => {
    const correctedRows = editableRows.filter(r => r.status === 'corrected' || r.status === 'error')
    if (correctedRows.length === 0) return

    setSubmitError(null)
    setSuccess(null)
    setProgress(0)
    startProgress()

    try {
      const payload = correctedRows.map(r => ({
        asset: r.current.asset,
        allocation_pct: parseFloat(r.current.allocation_pct) || 0
      }))

      const result = await mutation.mutateAsync({
        content: JSON.stringify(payload),
        contentType: 'application/json',
      })

      stopProgress(100)
      setEditableRows(prev => prev.map((row) => {
        if (row.status === 'corrected' || row.status === 'error') {
          return { ...row, status: 'success' as RowStatus, errors: [] }
        }
        return row
      }))

      setSuccess({ portfolioId: result.portfolioId })
      if (onImported) onImported(result.portfolioId)
    } catch (err: unknown) {
      stopProgress(0)
      const importError = err as Error & { rowErrors?: BulkImportRowError[] }
      const newErrors = importError.rowErrors ?? []

      setEditableRows(prev => prev.map((row) => {
        if (row.status !== 'corrected' && row.status !== 'error') return row
        const rowSpecificErrors = newErrors.filter(
          e => e.field === 'asset' || e.field === 'allocation_pct'
        )
        if (rowSpecificErrors.length > 0) {
          return { ...row, status: 'error' as RowStatus, errors: rowSpecificErrors }
        }
        return { ...row, status: 'success' as RowStatus, errors: [] }
      }))

      setRowErrors(newErrors)
      setSubmitError(importError.message || 'Retry failed for some rows')
    }
  }

  const rowBorderColor = (status: RowStatus): string => {
    switch (status) {
      case 'error': return 'border-red-400 dark:border-red-600'
      case 'corrected': return 'border-yellow-400 dark:border-yellow-600'
      case 'success': return 'border-green-400 dark:border-green-600'
      default: return 'border-gray-200 dark:border-gray-700'
    }
  }

  const rowBgColor = (status: RowStatus): string => {
    switch (status) {
      case 'error': return 'bg-red-50 dark:bg-red-900/20'
      case 'corrected': return 'bg-yellow-50 dark:bg-yellow-900/20'
      case 'success': return 'bg-green-50 dark:bg-green-900/20'
      default: return 'bg-white dark:bg-gray-800'
    }
  }

  const uploading = mutation.isPending

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Bulk Import Allocations
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Upload a CSV or JSON file with columns/fields <span className="font-mono">asset</span> and{' '}
        <span className="font-mono">allocation_pct</span>. The allocations must sum to 100%.
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop CSV or JSON file or click to browse"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          dragActive
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 hover:border-blue-400 dark:hover:border-blue-500'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          onChange={handlePickFile}
          className="sr-only"
        />
        <svg
          className={`w-10 h-10 ${dragActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16V4m0 0 4 4m-4-4L8 8m-5 9v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"
          />
        </svg>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {dragActive ? 'Drop your file here' : 'Drag & drop your CSV or JSON file here'}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          or <span className="font-semibold text-blue-600 dark:text-blue-400">click to browse</span>
        </p>
      </div>

      {file && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Selected: <span className="font-mono">{file.name}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={uploading || !file}
          onClick={handleImport}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {uploading ? 'Importing...' : 'Import'}
        </button>
      </div>

      {uploading && (
        <div className="mt-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Uploading file">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Uploading...
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {success && !uploading && (
        <div
          className="mt-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-4"
          role="status"
          aria-live="polite"
        >
          <div className="text-sm font-medium text-green-800 dark:text-green-200">
            Import successful — portfolio created.
          </div>
          <div className="text-xs text-green-700 dark:text-green-300 mt-1 font-mono">
            Portfolio ID: {success.portfolioId}
          </div>
        </div>
      )}

      {preview && editableRows.length === 0 && !success && (
        <div className="mt-4">
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Preview (first bytes)</div>
          <pre className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs overflow-auto max-h-40">
            {preview}
          </pre>
        </div>
      )}

      {submitError && (
        <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4" role="alert">
          <div className="text-sm font-medium text-red-800 dark:text-red-200">{submitError}</div>
          {meta && (
            <div className="text-xs text-red-700 dark:text-red-200 mt-1">
              Rows: {meta.validRows ?? 0} valid / {meta.totalRows ?? 0} total
            </div>
          )}
        </div>
      )}

      {editableRows.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
              Row Preview &amp; Validation
            </h4>
            {hasCorrectedRows && (
              <button
                type="button"
                disabled={uploading}
                onClick={handleRetryCorrected}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {uploading ? 'Retrying...' : 'Fix & Retry Corrected Rows'}
              </button>
            )}
          </div>
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-12">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Asset</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Allocation %</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {editableRows.map((row, idx) => {
                  const assetError = getErrorForField(row.errors, 'asset')
                  const allocError = getErrorForField(row.errors, 'allocation_pct')
                  return (
                    <tr
                      key={idx}
                      className={`border-t ${rowBorderColor(row.status)} ${rowBgColor(row.status)}`}
                    >
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2">
                        {(row.status === 'error' || row.status === 'corrected') ? (
                          <div>
                            <input
                              type="text"
                              value={row.current.asset}
                              onChange={(e) => handleCellEdit(idx, 'asset', e.target.value)}
                              className={`w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${assetError ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
                            />
                            {assetError && (
                              <div className="text-xs text-red-600 dark:text-red-400 mt-1">{assetError}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-900 dark:text-white font-mono">{row.current.asset}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {(row.status === 'error' || row.status === 'corrected') ? (
                          <div>
                            <input
                              type="text"
                              value={row.current.allocation_pct}
                              onChange={(e) => handleCellEdit(idx, 'allocation_pct', e.target.value)}
                              className={`w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${allocError ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
                            />
                            {allocError && (
                              <div className="text-xs text-red-600 dark:text-red-400 mt-1">{allocError}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-900 dark:text-white font-mono">{row.current.allocation_pct}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          row.status === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' :
                          row.status === 'corrected' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200' :
                          row.status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rowErrors.length > 0 && editableRows.length === 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            Validation details
          </h4>
          <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <ul className="space-y-2">
              {rowErrors.slice(0, 50).map((e, idx) => (
                <li
                  key={`${e.row}-${e.field}-${idx}`}
                  className="text-xs text-gray-700 dark:text-gray-200"
                >
                  <span className="font-mono text-gray-900 dark:text-white">
                    row {e.row}
                  </span>{' '}
                  <span className="font-mono">{e.field}</span>: {e.message}
                </li>
              ))}
            </ul>
            {rowErrors.length > 50 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Showing first 50 errors.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Backend limits: up to 10 assets and allocations must sum to 100%.
      </div>
    </div>
  )
}
