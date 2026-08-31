import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Save, CheckCircle, Download, Upload, X } from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'
import { getAnalyticsOptOut, setAnalyticsOptOut } from '../analytics'
import { downloadJSON } from '../utils/export'

const REBALANCE_THRESHOLD_KEY = 'user-rebalance-threshold'

function readThreshold(): number {
    try {
        const raw = localStorage.getItem(REBALANCE_THRESHOLD_KEY)
        const n = parseFloat(raw ?? '')
        return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 5
    } catch {
        return 5
    }
}

interface FormValues {
    analyticsOptOut: boolean
    rebalanceThreshold: number
}

function loadSaved(): FormValues {
    return {
        analyticsOptOut: getAnalyticsOptOut(),
        rebalanceThreshold: readThreshold(),
    }
}

interface ImportPreview {
    values: FormValues
    filename: string
}

function validateImportData(data: unknown): { valid: true; values: FormValues } | { valid: false; error: string } {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'File must contain a JSON object.' }
    }
    const obj = data as Record<string, unknown>
    if (typeof obj.analyticsOptOut !== 'boolean') {
        return { valid: false, error: 'Missing or invalid "analyticsOptOut" field (must be boolean).' }
    }
    if (typeof obj.rebalanceThreshold !== 'number' || !Number.isFinite(obj.rebalanceThreshold) || obj.rebalanceThreshold < 0 || obj.rebalanceThreshold > 100) {
        return { valid: false, error: 'Missing or invalid "rebalanceThreshold" field (must be a number between 0 and 100).' }
    }
    return { valid: true, values: { analyticsOptOut: obj.analyticsOptOut, rebalanceThreshold: obj.rebalanceThreshold } }
}

interface SettingsProps {
    onNavigate: (view: string) => void
    onDirtyChange?: (dirty: boolean) => void
}

const Settings: React.FC<SettingsProps> = ({ onNavigate, onDirtyChange }) => {
    const [saved, setSaved] = useState<FormValues>(loadSaved)
    const [form, setForm] = useState<FormValues>(loadSaved)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [importError, setImportError] = useState<string | null>(null)
    const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
    const [importSuccess, setImportSuccess] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const isDirty =
        form.analyticsOptOut !== saved.analyticsOptOut ||
        form.rebalanceThreshold !== saved.rebalanceThreshold

    useEffect(() => {
        onDirtyChange?.(isDirty)
    }, [isDirty, onDirtyChange])

    // Warn before browser-level navigation (tab close, refresh, address bar)
    useEffect(() => {
        if (!isDirty) return undefined
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [isDirty])

    // Wrap in-app navigation with a confirmation guard
    const guardedNavigate = useCallback(
        (view: string) => {
            if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
            onNavigate(view)
        },
        [isDirty, onNavigate],
    )

    const handleSave = () => {
        setAnalyticsOptOut(form.analyticsOptOut)
        try {
            localStorage.setItem(REBALANCE_THRESHOLD_KEY, String(form.rebalanceThreshold))
        } catch { /* ignore */ }
        setSaved(form)
        if (successTimer.current) clearTimeout(successTimer.current)
        setSaveSuccess(true)
        successTimer.current = setTimeout(() => setSaveSuccess(false), 2500)
    }

    const handleExport = () => {
        const data: FormValues = {
            analyticsOptOut: getAnalyticsOptOut(),
            rebalanceThreshold: readThreshold(),
        }
        downloadJSON('settings.json', data)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        setImportError(null)
        setImportPreview(null)
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string)
                const result = validateImportData(parsed)
                if (result.valid) {
                    setImportPreview({ values: result.values, filename: file.name })
                } else {
                    setImportError(result.error)
                }
            } catch {
                setImportError('Invalid JSON file. Please upload a valid JSON file.')
            }
        }
        reader.readAsText(file)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleApplyImport = () => {
        if (!importPreview) return
        setForm(importPreview.values)
        setImportPreview(null)
        setImportSuccess(true)
        setTimeout(() => setImportSuccess(false), 3000)
    }

    const handleCancelImport = () => {
        setImportPreview(null)
        setImportError(null)
    }

    useEffect(() => () => {
        if (successTimer.current) clearTimeout(successTimer.current)
    }, [])

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <div className="mx-auto max-w-2xl px-4 py-8">
                {/* Header */}
                <div className="mb-8 flex items-center gap-4">
                    <button
                        type="button"
                        onClick={() => guardedNavigate('dashboard')}
                        className="rounded-lg p-2 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Back to dashboard"
                    >
                        <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Manage your preferences</p>
                    </div>
                    {isDirty && (
                        <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            Unsaved changes
                        </span>
                    )}
                </div>

                <div className="space-y-6">
                    {/* Appearance — immediate effect, not part of the dirty form */}
                    <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                            Appearance
                        </h2>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Changes apply immediately and are saved automatically
                                </p>
                            </div>
                            <ThemeToggle />
                        </div>
                    </section>

                    {/* Privacy */}
                    <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                            Privacy
                        </h2>
                        <label className="flex cursor-pointer items-start gap-4">
                            <div className="flex h-5 items-center pt-0.5">
                                <input
                                    type="checkbox"
                                    checked={!form.analyticsOptOut}
                                    onChange={(e) =>
                                        setForm((f) => ({ ...f, analyticsOptOut: !e.target.checked }))
                                    }
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                                />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Allow anonymous usage analytics
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Cookie-free, self-hosted — no personal data collected. Helps improve the
                                    app. Analytics are always disabled in demo mode.
                                </p>
                            </div>
                        </label>
                    </section>

                    {/* Rebalancing */}
                    <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                            Rebalancing
                        </h2>
                        <div className="flex items-center justify-between gap-6">
                            <div>
                                <label
                                    htmlFor="rebalance-threshold"
                                    className="text-sm font-medium text-gray-700 dark:text-gray-300"
                                >
                                    Drift threshold (%)
                                </label>
                                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                    Trigger a rebalance alert when any allocation drifts beyond this amount
                                </p>
                            </div>
                            <input
                                id="rebalance-threshold"
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={form.rebalanceThreshold}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        rebalanceThreshold: Math.min(100, Math.max(0, Number(e.target.value))),
                                    }))
                                }
                                className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            />
                        </div>
                    </section>

                    {/* Import / Export */}
                    <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                            Import / Export Settings
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                            Export your settings as a JSON file or import settings from a previously exported file.
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handleExport}
                                className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Download className="h-4 w-4" aria-hidden />
                                Export
                            </button>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Upload className="h-4 w-4" aria-hidden />
                                Import
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                className="hidden"
                                onChange={handleFileSelect}
                                data-testid="import-file-input"
                            />
                        </div>
                        {importError && (
                            <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                                {importError}
                            </div>
                        )}
                        {importSuccess && (
                            <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                                <CheckCircle className="h-4 w-4" aria-hidden />
                                Settings imported successfully. Review and save to apply.
                            </div>
                        )}
                    </section>

                    {/* Import Preview Modal */}
                    {importPreview && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="import-preview-modal">
                            <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl border border-gray-200 dark:border-gray-700">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                        Import Preview
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={handleCancelImport}
                                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                                    File: {importPreview.filename}
                                </p>
                                <div className="space-y-3 text-sm">
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40">
                                        <span className="text-gray-600 dark:text-gray-400">Analytics opt-out</span>
                                        <span className="font-semibold text-gray-900 dark:text-white">
                                            {importPreview.values.analyticsOptOut ? 'Opted out' : 'Enabled'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40">
                                        <span className="text-gray-600 dark:text-gray-400">Drift threshold</span>
                                        <span className="font-semibold text-gray-900 dark:text-white">
                                            {importPreview.values.rebalanceThreshold}%
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-4 flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={handleCancelImport}
                                        className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleApplyImport}
                                        className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                    >
                                        Apply to Form
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Save row */}
                    <div className="flex items-center justify-end gap-3">
                        {saveSuccess && (
                            <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                                <CheckCircle className="h-4 w-4" aria-hidden />
                                Saved
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!isDirty}
                            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                        >
                            <Save className="h-4 w-4" aria-hidden />
                            Save changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Settings
