import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Save, CheckCircle } from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'
import { getAnalyticsOptOut, setAnalyticsOptOut } from '../analytics'

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

interface SettingsProps {
    onNavigate: (view: string) => void
    onDirtyChange?: (dirty: boolean) => void
}

const Settings: React.FC<SettingsProps> = ({ onNavigate, onDirtyChange }) => {
    const [saved, setSaved] = useState<FormValues>(loadSaved)
    const [form, setForm] = useState<FormValues>(loadSaved)
    const [saveSuccess, setSaveSuccess] = useState(false)
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
