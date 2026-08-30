import { useState, useMemo } from 'react'
import { ArrowLeft, FileDown, Receipt, Wallet } from 'lucide-react'
import { useTaxReportQuery } from '../hooks/queries/useTaxReportQuery'
import {
    downloadCSV,
    downloadJSON,
    toCSV,
    runExportWithProgress,
    idleExportProgress,
    type ExportProgressState,
} from '../utils/export'

interface TaxReportPageProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

const CSV_HEADERS = [
    'asset',
    'date',
    'type',
    'amount',
    'price',
    'costBasis',
    'realizedGainLoss',
]

const TaxReportPage: React.FC<TaxReportPageProps> = ({ onNavigate, publicKey }) => {
    const currentYear = new Date().getFullYear()
    const [year, setYear] = useState<number>(currentYear)
    const [progress, setProgress] = useState<ExportProgressState>(idleExportProgress())
    const { data, isLoading, isError } = useTaxReportQuery(publicKey ? year : null)

    const yearOptions = useMemo(() => {
        const years: number[] = []
        for (let y = currentYear; y >= 2000; y -= 1) years.push(y)
        return years
    }, [currentYear])

    const handleExportCSV = async () => {
        if (!data) return
        try {
            await runExportWithProgress(
                { preparing: 'Preparing CSV export…', downloading: 'Downloading CSV…', complete: 'CSV downloaded' },
                setProgress,
                async () => {
                    const csv = toCSV(
                        data.entries.map((e) => ({
                            asset: e.asset,
                            date: e.date,
                            type: e.type,
                            amount: e.amount,
                            price: e.price,
                            costBasis: e.costBasis,
                            realizedGainLoss: e.realizedGainLoss,
                        })),
                        CSV_HEADERS,
                    )
                    downloadCSV(`tax-report-${year}.csv`, csv)
                },
            )
        } catch {
            // progress state already reflects the error
        }
    }

    const handleExportJSON = async () => {
        if (!data) return
        try {
            await runExportWithProgress(
                { preparing: 'Preparing JSON export…', downloading: 'Downloading JSON…', complete: 'JSON downloaded' },
                setProgress,
                async () => {
                    downloadJSON(`tax-report-${year}.json`, data)
                },
            )
        } catch {
            // progress state already reflects the error
        }
    }

    if (!publicKey) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-6">
                <div className="text-center">
                    <Wallet className="w-12 h-12 mx-auto mb-3 text-gray-400 dark:text-gray-500" aria-hidden />
                    <p className="text-gray-600 dark:text-gray-400">Connect a wallet to view your tax report</p>
                    <button
                        type="button"
                        onClick={() => onNavigate('landing')}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Connect Wallet
                    </button>
                </div>
            </div>
        )
    }

    const gainLoss = data?.totalRealizedGainLoss ?? 0
    const gainLossLabel = gainLoss >= 0 ? 'Total realized gain' : 'Total realized loss'
    const gainLossValue = `$${Math.abs(gainLoss).toFixed(2)}`

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={() => onNavigate('dashboard')}
                            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            aria-label="Back to dashboard"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tax Report</h1>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Realized gains and losses computed with FIFO cost basis
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tax year</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="block">
                                <span className="sr-only">Tax year</span>
                                <select
                                    value={year}
                                    onChange={(e) => setYear(Number(e.target.value))}
                                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                >
                                    {yearOptions.map((y) => (
                                        <option key={y} value={y}>
                                            {y}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {data ? (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleExportCSV}
                                        className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        <FileDown className="w-4 h-4" aria-hidden />
                                        CSV
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleExportJSON}
                                        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        <FileDown className="w-4 h-4" aria-hidden />
                                        JSON
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                    {progress.label ? (
                        <p role="status" className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            {progress.label}
                            {progress.detail ? ` — ${progress.detail}` : ''}
                        </p>
                    ) : null}
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" role="status" aria-label="Loading tax report" />
                    </div>
                ) : isError ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm text-center">
                        <Receipt className="w-10 h-10 mx-auto mb-2 text-gray-400 dark:text-gray-500" aria-hidden />
                        <p className="text-gray-600 dark:text-gray-400">
                            Could not load the tax report for {year}. Try again in a moment.
                        </p>
                    </div>
                ) : data ? (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                <p className="text-sm text-gray-600 dark:text-gray-400">{gainLossLabel}</p>
                                <p className={`text-2xl font-bold mt-1 ${gainLoss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {gainLossValue}
                                </p>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                <p className="text-sm text-gray-600 dark:text-gray-400">Total trades</p>
                                <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{data.totalTrades}</p>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                <p className="text-sm text-gray-600 dark:text-gray-400">Cost basis method</p>
                                <p className="text-lg font-bold mt-1 text-gray-900 dark:text-white">FIFO</p>
                            </div>
                        </div>

                        {data.entries.length > 0 ? (
                            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                            <th className="px-4 py-3 font-medium">Asset</th>
                                            <th className="px-4 py-3 font-medium">Date</th>
                                            <th className="px-4 py-3 font-medium">Type</th>
                                            <th className="px-4 py-3 font-medium">Amount</th>
                                            <th className="px-4 py-3 font-medium">Price</th>
                                            <th className="px-4 py-3 font-medium">Cost basis</th>
                                            <th className="px-4 py-3 font-medium">Realized gain/loss</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.entries.map((entry, index) => (
                                            <tr key={`${entry.date}-${entry.asset}-${entry.type}-${index}`} className="border-b border-gray-100 dark:border-gray-800">
                                                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{entry.asset}</td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{new Date(entry.date).toLocaleDateString()}</td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                                            entry.type === 'sell'
                                                                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                                                : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                                        }`}
                                                    >
                                                        {entry.type}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{entry.amount.toFixed(4)}</td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">${entry.price.toFixed(4)}</td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">${entry.costBasis.toFixed(2)}</td>
                                                <td className={`px-4 py-3 font-medium ${entry.realizedGainLoss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                    {entry.realizedGainLoss >= 0 ? '+' : ''}${entry.realizedGainLoss.toFixed(2)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm text-center">
                                <Receipt className="w-10 h-10 mx-auto mb-2 text-gray-400 dark:text-gray-500" aria-hidden />
                                <p className="text-gray-600 dark:text-gray-400">
                                    No trades recorded in {year}.
                                </p>
                            </div>
                        )}

                        <p className="mt-4 text-xs text-gray-500 dark:text-gray-500">{data.methodology}</p>
                    </>
                ) : null}
            </div>
        </div>
    )
}

export default TaxReportPage
