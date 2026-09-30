import { useMemo, useState } from 'react'
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceDot,
} from 'recharts'
import { AlertTriangle, ArrowLeft, History, Plus, Trash2 } from 'lucide-react'
import { useBacktestMutation } from '../hooks/mutations/useBacktestMutation'

interface BacktestPageProps {
    onNavigate: (view: string) => void
}

interface AllocationRow {
    asset: string
    percentage: number
}

export const DEFAULT_BACKTEST_ALLOCATIONS: AllocationRow[] = [
    { asset: 'XLM', percentage: 40 },
    { asset: 'BTC', percentage: 30 },
    { asset: 'USDC', percentage: 30 },
]

const PERIOD_OPTIONS = [30, 90, 180, 365]

const formatUsd = (value: number) =>
    value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

const formatDate = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const BacktestPage: React.FC<BacktestPageProps> = ({ onNavigate }) => {
    const [rows, setRows] = useState<AllocationRow[]>(DEFAULT_BACKTEST_ALLOCATIONS)
    const [threshold, setThreshold] = useState(5)
    const [days, setDays] = useState(90)
    const backtest = useBacktestMutation()
    const result = backtest.data

    const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.percentage) ? row.percentage : 0), 0)
    const symbols = rows.map((row) => row.asset.trim().toUpperCase())
    const hasDuplicates = new Set(symbols).size !== symbols.length
    const validationError =
        rows.length === 0 ? 'Add at least one asset'
            : symbols.some((s) => !s) ? 'Every row needs an asset symbol'
                : hasDuplicates ? 'Each asset can only appear once'
                    : Math.abs(total - 100) > 0.01 ? `Allocations must sum to 100% (currently ${total.toFixed(2)}%)`
                        : threshold < 1 || threshold > 50 ? 'Threshold must be between 1% and 50%'
                            : null

    const updateRow = (index: number, patch: Partial<AllocationRow>) =>
        setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))

    const runSimulation = () => {
        if (validationError) return
        backtest.mutate({
            allocations: Object.fromEntries(rows.map((row) => [row.asset.trim().toUpperCase(), row.percentage])),
            threshold,
            days,
        })
    }

    const chartData = useMemo(
        () => result?.timeline.map((point) => ({ ...point, date: formatDate(point.timestamp) })) ?? [],
        [result],
    )

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <button
                        type="button"
                        onClick={() => onNavigate('dashboard')}
                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        aria-label="Back to dashboard"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Rebalance Simulator</h1>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            See how a rebalance threshold would have behaved on real historical prices
                        </p>
                    </div>
                </div>

                <div
                    role="note"
                    className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 mb-6 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
                >
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
                    <p>
                        <strong>Historical simulation, not a guarantee.</strong> Results replay past daily closing
                        prices from CoinGecko and ignore fees, slippage and execution timing. Past performance does
                        not predict future results.
                    </p>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Inputs</h2>

                    <div className="space-y-2 mb-4">
                        {rows.map((row, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <label className="flex-1">
                                    <span className="sr-only">Asset {index + 1}</span>
                                    <input
                                        type="text"
                                        value={row.asset}
                                        onChange={(e) => updateRow(index, { asset: e.target.value })}
                                        placeholder="Asset (e.g. XLM)"
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                </label>
                                <label className="w-32">
                                    <span className="sr-only">{row.asset || `Asset ${index + 1}`} allocation percent</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.01}
                                        value={row.percentage}
                                        onChange={(e) => updateRow(index, { percentage: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                </label>
                                <span className="text-gray-500 dark:text-gray-400">%</span>
                                <button
                                    type="button"
                                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                                    className="p-2 text-gray-500 hover:text-red-600 rounded-lg"
                                    aria-label={`Remove ${row.asset || `asset ${index + 1}`}`}
                                >
                                    <Trash2 className="w-4 h-4" aria-hidden />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setRows((prev) => [...prev, { asset: '', percentage: 0 }])}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            <Plus className="w-4 h-4" aria-hidden /> Add asset
                        </button>
                    </div>

                    <div className="flex flex-wrap items-end gap-4">
                        <label className="block">
                            <span className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Threshold: {threshold}%</span>
                            <input
                                type="range"
                                min={1}
                                max={50}
                                step={1}
                                value={threshold}
                                onChange={(e) => setThreshold(Number(e.target.value))}
                                className="w-56"
                            />
                        </label>
                        <label className="block">
                            <span className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Period</span>
                            <select
                                value={days}
                                onChange={(e) => setDays(Number(e.target.value))}
                                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                                {PERIOD_OPTIONS.map((d) => (
                                    <option key={d} value={d}>Last {d} days</option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            onClick={runSimulation}
                            disabled={!!validationError || backtest.isPending}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <History className="w-4 h-4" aria-hidden />
                            {backtest.isPending ? 'Simulating…' : 'Run simulation'}
                        </button>
                    </div>

                    {validationError && (
                        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{validationError}</p>
                    )}
                    {backtest.isError && (
                        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                            Could not run the simulation: {backtest.error instanceof Error ? backtest.error.message : 'unknown error'}
                        </p>
                    )}
                </div>

                {result && (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            {[
                                { label: `Rebalanced at ${result.threshold}%`, value: formatUsd(result.finalValue), sub: formatPct(result.totalReturnPct) },
                                { label: 'Buy and hold', value: formatUsd(result.buyAndHoldFinalValue), sub: formatPct(result.buyAndHoldReturnPct) },
                                { label: 'Rebalances triggered', value: String(result.rebalanceCount), sub: `over ${result.days} days` },
                                { label: 'Max drawdown', value: `${result.maxDrawdownPct.toFixed(2)}%`, sub: `peak drift ${result.maxDriftObservedPct.toFixed(2)}%` },
                            ].map((stat) => (
                                <div key={stat.label} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
                                    <p className="text-sm text-gray-600 dark:text-gray-400">{stat.label}</p>
                                    <p className="text-xl font-semibold text-gray-900 dark:text-white">{stat.value}</p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{stat.sub}</p>
                                </div>
                            ))}
                        </div>

                        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Simulated portfolio value</h2>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                {formatDate(result.startTimestamp)} – {formatDate(result.endTimestamp)} ·
                                starting at {formatUsd(result.initialValue)} · dots mark rebalances
                            </p>
                            <div className="h-80" data-testid="backtest-chart">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" minTickGap={32} />
                                        <YAxis tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`} width={80} />
                                        <Tooltip formatter={(v) => (typeof v === 'number' ? formatUsd(v) : '—')} />
                                        <Legend />
                                        <Line type="monotone" dataKey="value" name={`Rebalanced (${result.threshold}%)`} stroke="#3B82F6" dot={false} strokeWidth={2} />
                                        <Line type="monotone" dataKey="buyAndHoldValue" name="Buy and hold" stroke="#9CA3AF" dot={false} strokeDasharray="4 4" />
                                        {chartData.filter((p) => p.rebalanced).map((p) => (
                                            <ReferenceDot key={p.timestamp} x={p.date} y={p.value} r={4} fill="#3B82F6" stroke="none" />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Rebalance events</h2>
                            {result.events.length === 0 ? (
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Drift never exceeded {result.threshold}% in this period, so no rebalance would have triggered.
                                </p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-600 dark:text-gray-400">
                                            <th className="py-2">Date</th>
                                            <th className="py-2">Most drifted asset</th>
                                            <th className="py-2">Drift</th>
                                            <th className="py-2">Portfolio value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.events.map((event) => (
                                            <tr key={event.timestamp} className="border-t border-gray-100 dark:border-gray-700 text-gray-900 dark:text-white">
                                                <td className="py-2">{formatDate(event.timestamp)}</td>
                                                <td className="py-2">{event.asset}</td>
                                                <td className="py-2">{event.maxDriftPct.toFixed(2)}%</td>
                                                <td className="py-2">{formatUsd(event.portfolioValue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">{result.disclaimer}</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default BacktestPage
