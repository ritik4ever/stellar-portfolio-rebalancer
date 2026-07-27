import React, { useEffect, useState, useCallback } from 'react'
import { ShieldAlert, RefreshCw, Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useSystemStatusQuery, useQueueHealthQuery, useWorkersHealthQuery, useResetCircuitBreakerMutation, adminOpsKeys } from '../hooks/queries/useAdminOpsQueries'
import { queryClient } from '../providers/QueryProvider'

type AdminGuardState = 'loading' | 'authorized' | 'forbidden' | 'error'

function formatCooldown(ts: number | undefined): string {
    if (!ts) return '—'
    const diff = ts - Date.now()
    if (diff <= 0) return 'expired'
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    return `${minutes}m ${seconds}s`
}

function AdminGuard({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<AdminGuardState>('loading')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        const controller = new AbortController()

        async function check() {
            try {
                const { adminRequest } = await import('../services/adminService')
                const { ENDPOINTS } = await import('../config/api')
                await adminRequest<any>(ENDPOINTS.ADMIN_DB_QUERIES, {
                    method: 'GET',
                    signal: controller.signal,
                })
                if (!cancelled) setState('authorized')
            } catch (err) {
                if (cancelled) return
                if (err instanceof Error && (err.message.includes('FORBIDDEN') || err.message.includes('403'))) {
                    setState('forbidden')
                } else {
                    setErrorMessage(err instanceof Error ? err.message : 'Unknown error')
                    setState('error')
                }
            }
        }

        void check()
        return () => {
            cancelled = true
            controller.abort()
        }
    }, [])

    if (state === 'loading') {
        return <div className="flex items-center justify-center p-8 text-sm text-gray-500">Verifying admin access…</div>
    }
    if (state === 'forbidden') {
        return (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <ShieldAlert className="h-10 w-10 text-red-500" />
                <p className="text-sm font-medium text-gray-900 dark:text-white">Access denied</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">You do not have permission to view this page.</p>
            </div>
        )
    }
    if (state === 'error') {
        return (
            <div className="p-8 text-center text-sm text-red-600 dark:text-red-400" role="alert">
                {errorMessage || 'Failed to verify admin access.'}
            </div>
        )
    }
    return <>{children}</>
}

function usePollingRefresh(fn: () => void, intervalMs = 30_000) {
    useEffect(() => {
        const id = setInterval(fn, intervalMs)
        return () => clearInterval(id)
    }, [fn, intervalMs])
}

export default function AdminOps() {
    const systemQuery = useSystemStatusQuery()
    const queueQuery = useQueueHealthQuery()
    const workersQuery = useWorkersHealthQuery()
    const resetMutation = useResetCircuitBreakerMutation()

    const refreshAll = useCallback(() => {
        void systemQuery.refetch()
        void queueQuery.refetch()
        void workersQuery.refetch()
    }, [queueQuery, systemQuery, workersQuery])

    usePollingRefresh(refreshAll, 30_000)

    const systemData = systemQuery.data?.data
    const queueData = queueQuery.data?.data
    const workersData = workersQuery.data?.data

    const circuitBreakers = systemData?.riskManagement?.circuitBreakers ?? {}
    const trippedAssets = Object.entries(circuitBreakers).filter(([, v]) => v.isTriggered)

    const isLoading = systemQuery.isLoading && queueQuery.isLoading && workersQuery.isLoading
    const isError = systemQuery.isError || queueQuery.isError || workersQuery.isError
    const isEmpty = !isLoading && !isError && trippedAssets.length === 0 && Object.keys(circuitBreakers).length === 0

    return (
        <AdminGuard>
            <div className="mx-auto max-w-7xl px-4 py-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Operations</h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Circuit breaker status, queue backlog, and worker health
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => refreshAll()}
                        disabled={systemQuery.isFetching || queueQuery.isFetching || workersQuery.isFetching}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                        <RefreshCw className={`h-4 w-4 ${systemQuery.isFetching || queueQuery.isFetching || workersQuery.isFetching ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>

                {isError && (
                    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
                        <AlertTriangle className="mr-2 inline h-4 w-4" />
                        Failed to load operational data.
                        <button type="button" onClick={() => refreshAll()} className="ml-3 underline">
                            Retry
                        </button>
                    </div>
                )}

                {isLoading && (
                    <div className="space-y-4">
                        <div className="h-48 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
                        <div className="h-48 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
                        <div className="h-48 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
                    </div>
                )}

                {isEmpty && !isLoading && (
                    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
                        <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
                        <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">All systems nominal</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">No circuit breakers tripped and operational data is available.</p>
                    </div>
                )}

                {!isLoading && !isEmpty && (
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <div className="mb-4 flex items-center gap-2">
                                <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Circuit Breakers</h2>
                            </div>
                            {trippedAssets.length === 0 ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400">All circuit breakers are healthy.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-left text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Asset</th>
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Status</th>
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Reason</th>
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Cooldown</th>
                                                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {trippedAssets.map(([asset, status]) => (
                                                <tr key={asset} className="border-b border-gray-100 dark:border-gray-700/60">
                                                    <td className="py-3 pr-4 font-mono text-gray-900 dark:text-white">{asset}</td>
                                                    <td className="py-3 pr-4">
                                                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/50 dark:text-red-200">
                                                            Tripped
                                                        </span>
                                                    </td>
                                                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{status.triggerReason || '—'}</td>
                                                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{formatCooldown(status.cooldownUntil)}</td>
                                                    <td className="py-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => resetMutation.mutate(asset)}
                                                            disabled={resetMutation.isPending}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            {resetMutation.isPending ? 'Resetting…' : 'Reset'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {resetMutation.isError && (
                                <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
                                    {resetMutation.error instanceof Error ? resetMutation.error.message : 'Reset failed'}
                                </p>
                            )}
                            {resetMutation.isSuccess && (
                                <p className="mt-3 text-xs text-green-600 dark:text-green-400" role="status">
                                    Circuit breaker reset successfully.
                                </p>
                            )}
                        </section>

                        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <div className="mb-4 flex items-center gap-2">
                                <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Queue Backlog</h2>
                            </div>
                            {!queueData?.redisConnected ? (
                                <p className="text-sm text-amber-600 dark:text-amber-400">Redis unavailable — queue metrics offline.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-left text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Queue</th>
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Waiting</th>
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Active</th>
                                                <th className="pb-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Delayed</th>
                                                <th className="pb-2 font-medium text-gray-500 dark:text-gray-400">Failed</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(queueData.queues).map(([name, stats]) => (
                                                <tr key={name} className="border-b border-gray-100 dark:border-gray-700/60">
                                                    <td className="py-3 pr-4 font-mono text-gray-900 dark:text-white">{name}</td>
                                                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{stats.waiting}</td>
                                                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{stats.active}</td>
                                                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{stats.delayed}</td>
                                                    <td className="py-3 text-gray-600 dark:text-gray-300">{stats.failed}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <div className="mb-4 flex items-center gap-2">
                                <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Worker Health</h2>
                            </div>
                            {!workersData?.data ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400">No worker health data available.</p>
                            ) : (
                                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                    {(['healthy', 'unhealthy', 'idle', 'lagging'] as const).map((key) => (
                                        <div key={key} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{key}</p>
                                            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                                                {(workersData.data.summary as Record<string, number>)[key]}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                                Total workers: {(workersData?.data?.summary?.total ?? 0).toLocaleString()}
                            </div>
                        </section>

                        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <div className="mb-4 flex items-center gap-2">
                                <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">System Status</h2>
                            </div>
                            {!systemData ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400">No system status data available.</p>
                            ) : (
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <SystemBadge label="Price Feeds" value={systemData.services.priceFeeds} />
                                    <SystemBadge label="Risk Management" value={systemData.services.riskManagement} />
                                    <SystemBadge label="WebSockets" value={systemData.services.webSockets} />
                                    <SystemBadge label="Auto Rebalance" value={systemData.services.autoRebalancing} />
                                    <SystemBadge label="Stellar Network" value={systemData.services.stellarNetwork} />
                                    <SystemBadge label="Event Indexer" value={systemData.services.contractEventIndexer} />
                                </div>
                            )}
                            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                                Uptime: {systemData?.system?.uptime ? `${Math.floor(systemData.system.uptime / 60)}m` : '—'}
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </AdminGuard>
    )
}

function SystemBadge({ label, value }: { label: string; value: boolean }) {
    return (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
            {value ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-4 w-4" /> Online
                </span>
            ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300">
                    <XCircle className="h-4 w-4" /> Offline
                </span>
            )}
        </div>
    )
}
