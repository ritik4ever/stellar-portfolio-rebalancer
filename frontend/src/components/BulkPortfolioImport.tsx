import { useMemo, useState } from 'react'

// When the repo’s frontend types are temporarily broken in this agent environment,
// keep this component written with conservative typing to avoid amplifying TS errors.
// The runtime behavior is standard React.


type BulkImportRowError = {
  row: number
  field: string
  message: string
}

type BulkImportValidationError = {
  error: 'VALIDATION_ERROR' | string
  message?: string
  code?: string
  errors?: BulkImportRowError[]
  meta?: {
    totalRows?: number
    validRows?: number
  }
}

type BulkImportSuccessResponse = {
  portfolioId: string
  status: 'created'
}

function detectLikelyJson(file: File): boolean {
  const name = file.name.toLowerCase()
  return file.type.includes('json') || name.endsWith('.json')
}

function detectLikelyCsv(file: File): boolean {
  const name = file.name.toLowerCase()
  return file.type.includes('csv') || name.endsWith('.csv')
}

export default function BulkPortfolioImport(props: {
  userAddressForDemo?: string | null
  onImported?: (portfolioId: string) => void
}): JSX.Element {
  const { onImported } = props

  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<BulkImportRowError[]>([])
  const [meta, setMeta] = useState<{ totalRows?: number; validRows?: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const importMode = useMemo(() => {
    if (!file) return 'unknown'
    if (detectLikelyJson(file)) return 'json'
    if (detectLikelyCsv(file)) return 'csv'
    // Fallback by MIME/name
    return file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'
  }, [file])

  const handlePickFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setSubmitError(null)
    setRowErrors([])
    setMeta(null)

    const picked = e.target.files?.[0] ?? null
    setFile(picked)

    if (!picked) {
      setPreview(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      // Keep preview short (first ~2KB)
      setPreview(text.slice(0, 2048))
    }
    reader.readAsText(picked)
  }

  const handleImport = async () => {
    if (!file) {
      setSubmitError('Choose a CSV or JSON file first')
      return
    }

    setBusy(true)
    setSubmitError(null)
    setRowErrors([])
    setMeta(null)

    try {
      const likelyJson = detectLikelyJson(file) || importMode === 'json'
      const text = await file.text()

      // Backend accepts JSON (parsed by express.json) OR CSV.
      // We send raw JSON text only for application/json; otherwise send as plain text.
      const headers: Record<string, string> = {
        Accept: 'application/json',
      }

      // If the backend guesses format from content-type/body-type, set it.
      if (likelyJson) headers['Content-Type'] = 'application/json'
      else headers['Content-Type'] = 'text/csv'

      const res = await fetch('/api/v1/portfolio/import', {
        method: 'POST',
        headers,
        body: likelyJson ? text : text,
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        const err = data as BulkImportValidationError | null
        const errors = err?.errors ?? []
        setRowErrors(errors)
        setMeta(err?.meta ?? null)
        setSubmitError(err?.message || 'Import failed')
        return
      }

      const okData = data as BulkImportSuccessResponse
      if (onImported) onImported(okData.portfolioId)
    } catch (e: any) {
      setSubmitError(e?.message ? String(e.message) : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Bulk Import Allocations
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Upload a CSV or JSON file with columns/fields <span className="font-mono">asset</span> and{' '}
        <span className="font-mono">allocation_pct</span>. The allocations must sum to 100%.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            File (CSV or JSON)
          </label>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={handlePickFile}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          {file && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Selected: <span className="font-mono">{file.name}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={busy || !file}
          onClick={handleImport}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>

      {preview && (
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

      {rowErrors.length > 0 && (
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

