import React, { useCallback, useEffect, useState } from 'react'
import { Bug, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react'
import { API_CONFIG, testBrowserPrices } from '../config/api'
import { API_RESOURCE_ROOT } from '../config/api'
import { getFrontendDebugConfig } from '../utils/debug'
import { browserPriceService, type BrowserPriceCacheEntry } from '../services/browserPriceService'
import { NotificationTest } from './NotificationTest'

const DRAWER_UNLOCK_KEY = 'developer-drawer-unlocked'

export function isDeveloperDrawerUnlocked(): boolean {
    if (typeof window === 'undefined') return false
    if (getFrontendDebugConfig().isDevelopment) return true
    return sessionStorage.getItem(DRAWER_UNLOCK_KEY) === 'true'
}

export function unlockDeveloperDrawer(): void {
    sessionStorage.setItem(DRAWER_UNLOCK_KEY, 'true')
}

interface DeveloperDrawerProps {
    publicKey: string | null
}

function formatAge(ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms)) return '—'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

const DeveloperDrawer: React.FC<DeveloperDrawerProps> = ({ publicKey }) => {
    const [open, setOpen] = useState(false)
    const [unlocked, setUnlocked] = useState(isDeveloperDrawerUnlocked)
    const [cacheEntries, setCacheEntries] = useState<BrowserPriceCacheEntry[]>([])
    const [cacheLoading, setCacheLoading] = useState(false)
    const [cacheError, setCacheError] = useState<string | null>(null)
    const [browserPriceTestRunning, setBrowserPriceTestRunning] = useState(false)
    const [browserPriceTestResult, setBrowserPriceTestResult] = useState<string | null>(null)
    const debugConfig = getFrontendDebugConfig()

    const refreshCacheInspector = useCallback(async () => {
        setCacheLoading(true)
        setCacheError(null)
        try {
            const entries = browserPriceService.getCacheInspectorEntries()
            setCacheEntries(entries)
            if (entries.length === 0) {
                await browserPriceService.getCurrentPrices()
                setCacheEntries(browserPriceService.getCacheInspectorEntries())
            }
        } catch (error) {
            setCacheError(error instanceof Error ? error.message : 'Failed to load cache entries')
            setCacheEntries([])
        } finally {
            setCacheLoading(false)
        }
    }, [])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
                event.preventDefault()
                unlockDeveloperDrawer()
                setUnlocked(true)
                setOpen((value) => !value)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    useEffect(() => {
        if (open) {
            void refreshCacheInspector()
        }
    }, [open, refreshCacheInspector])

    const runBrowserPriceTest = async () => {
        setBrowserPriceTestRunning(true)
        setBrowserPriceTestResult(null)
        try {
            const ok = await testBrowserPrices()
            setBrowserPriceTestResult(ok ? 'Browser price connection OK' : 'Browser price test failed')
        } catch (error) {
            setBrowserPriceTestResult(
                error instanceof Error ? error.message : 'Browser price test failed',
            )
        } finally {
            setBrowserPriceTestRunning(false)
        }
    }

    if (!unlocked) {
        return (
            <button
                type="button"
                aria-label="Unlock developer tools"
                title="Developer tools (Ctrl+Shift+D)"
                onClick={() => {
                    unlockDeveloperDrawer()
                    setUnlocked(true)
                    setOpen(true)
                }}
                className="fixed bottom-3 left-3 z-40 h-2 w-2 rounded-full bg-transparent hover:bg-gray-400/30 dark:hover:bg-gray-500/30 focus-visible:ring-2 focus-visible:ring-blue-500"
            />
        )
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls="developer-drawer-panel"
                className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-md hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
                <Bug className="h-4 w-4" />
                Dev tools
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>

            {open ? (
                <div
                    id="developer-drawer-panel"
                    role="dialog"
                    aria-label="Developer tools"
                    className="fixed bottom-16 left-4 z-40 flex max-h-[min(70vh,32rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
                >
                    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Developer tools</h2>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close developer tools"
                            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs text-gray-700 dark:text-gray-300">
                        <section>
                            <h3 className="mb-2 font-medium text-gray-900 dark:text-white">API target</h3>
                            <dl className="space-y-1">
                                <div className="flex justify-between gap-2">
                                    <dt>Origin</dt>
                                    <dd className="text-right break-all">{API_CONFIG.BASE_URL}</dd>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <dt>Resource root</dt>
                                    <dd>{API_RESOURCE_ROOT}</dd>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <dt>Debug logs</dt>
                                    <dd>{debugConfig.enableApiDebugLogs ? 'on' : 'off'}</dd>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <dt>Browser prices</dt>
                                    <dd>{API_CONFIG.USE_BROWSER_PRICES ? 'on' : 'off'}</dd>
                                </div>
                            </dl>
                            <button
                                type="button"
                                onClick={() => void runBrowserPriceTest()}
                                disabled={browserPriceTestRunning}
                                className="mt-2 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
                            >
                                {browserPriceTestRunning ? 'Testing…' : 'Test browser prices'}
                            </button>
                            {browserPriceTestResult ? (
                                <p className="mt-1 text-gray-600 dark:text-gray-400">{browserPriceTestResult}</p>
                            ) : null}
                        </section>

                        <section>
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="font-medium text-gray-900 dark:text-white">Browser price cache</h3>
                                <button
                                    type="button"
                                    onClick={() => void refreshCacheInspector()}
                                    disabled={cacheLoading}
                                    className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
                                >
                                    <RefreshCw className={`h-3 w-3 ${cacheLoading ? 'animate-spin' : ''}`} />
                                    Refresh
                                </button>
                            </div>
                            {cacheError ? (
                                <p className="text-red-600 dark:text-red-400" role="alert">
                                    {cacheError}
                                </p>
                            ) : null}
                            {cacheLoading && cacheEntries.length === 0 ? (
                                <p className="text-gray-500 dark:text-gray-400">Loading cache…</p>
                            ) : null}
                            {!cacheLoading && cacheEntries.length === 0 ? (
                                <p className="text-gray-500 dark:text-gray-400">No cached price buckets yet.</p>
                            ) : null}
                            {cacheEntries.length > 0 ? (
                                <ul className="space-y-2">
                                    {cacheEntries.map((entry) => (
                                        <li
                                            key={entry.key}
                                            className="rounded border border-gray-200 p-2 dark:border-gray-700"
                                        >
                                            <div className="flex justify-between gap-2 font-medium">
                                                <span>{entry.key}</span>
                                                <span>{entry.assetCount} assets</span>
                                            </div>
                                            <div className="mt-1 space-y-0.5 text-gray-600 dark:text-gray-400">
                                                <div>Freshness: {formatAge(entry.ageMs)}</div>
                                                <div>TTL remaining: {formatAge(entry.ttlRemainingMs)}</div>
                                                <div>Hint: {entry.resolutionHint}</div>
                                                <div>Sources: {entry.sources.join(', ') || '—'}</div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => {
                                    browserPriceService.clearCache()
                                    setCacheEntries([])
                                }}
                                className="mt-2 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                            >
                                Clear cache
                            </button>
                        </section>

                        {publicKey ? (
                            <section>
                                <h3 className="mb-2 font-medium text-gray-900 dark:text-white">
                                    Notification tests
                                </h3>
                                <NotificationTest userId={publicKey} />
                            </section>
                        ) : (
                            <p className="text-gray-500 dark:text-gray-400">
                                Connect a wallet to run notification delivery tests.
                            </p>
                        )}
                    </div>
                </div>
            ) : null}
        </>
    )
}

export default DeveloperDrawer
