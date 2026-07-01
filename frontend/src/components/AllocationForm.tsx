import { useCallback, useMemo } from 'react'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'

interface Allocation {
    asset: string
    percentage: number
}

interface AllocationFormProps {
    allocations: Allocation[]
    onChange: (allocations: Allocation[]) => void
    disabled?: boolean
}

const AVAILABLE_ASSETS = ['XLM', 'USDC', 'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'ATOM']

function getAllocationError(percentage: number): string | null {
    if (percentage < 0) return 'Cannot be negative'
    if (percentage > 100) return 'Cannot exceed 100%'
    return null
}

export default function AllocationForm({ allocations, onChange, disabled }: AllocationFormProps) {
    const totalPercentage = useMemo(
        () => allocations.reduce((sum, a) => sum + a.percentage, 0),
        [allocations],
    )

    const isValidTotal = Math.abs(totalPercentage - 100) < 0.01

    const deviation = parseFloat((totalPercentage - 100).toFixed(1))

    const hasAnyFieldError = allocations.some(
        (a) => getAllocationError(a.percentage) !== null,
    )

    const statusMessage = useMemo(() => {
        if (isValidTotal) return { text: 'Allocations sum to 100%', type: 'success' as const }
        if (deviation > 0) return { text: `${deviation}% over — reduce by ${deviation}%`, type: 'error' as const }
        return { text: `${Math.abs(deviation)}% under — add ${Math.abs(deviation)}% more`, type: 'warning' as const }
    }, [isValidTotal, deviation])

    const unusedAssets = AVAILABLE_ASSETS.filter(
        (a) => !allocations.some((alloc) => alloc.asset === a),
    )

    const addAllocation = useCallback(() => {
        if (unusedAssets.length === 0) return
        onChange([...allocations, { asset: unusedAssets[0], percentage: 0 }])
    }, [allocations, unusedAssets, onChange])

    const removeAllocation = useCallback((index: number) => {
        if (allocations.length <= 1) return
        onChange(allocations.filter((_, i) => i !== index))
    }, [allocations, onChange])

    const updateAllocation = useCallback((index: number, field: 'asset' | 'percentage', value: string | number) => {
        const updated = [...allocations]
        updated[index] = { ...updated[index], [field]: value }
        onChange(updated)
    }, [allocations, onChange])

    const canSubmit = isValidTotal && !hasAnyFieldError && !disabled

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Asset Allocations
                </h3>
                <button
                    type="button"
                    onClick={addAllocation}
                    disabled={unusedAssets.length === 0 || disabled}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
                >
                    <Plus className="h-4 w-4" />
                    Add Asset
                </button>
            </div>

            {allocations.map((allocation, index) => {
                const fieldError = getAllocationError(allocation.percentage)
                return (
                    <div key={index} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="flex items-center gap-4">
                            <div className="min-w-0 flex-1">
                                <select
                                    value={allocation.asset}
                                    onChange={(e) => updateAllocation(index, 'asset', e.target.value)}
                                    disabled={disabled}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                >
                                    {AVAILABLE_ASSETS.map((asset) => (
                                        <option key={asset} value={asset} disabled={asset !== allocation.asset && allocations.some((a) => a.asset === asset)}>
                                            {asset}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="w-32">
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    value={allocation.percentage}
                                    onChange={(e) => updateAllocation(index, 'percentage', parseFloat(e.target.value))}
                                    disabled={disabled}
                                    aria-label={`${allocation.asset} allocation percentage`}
                                    className="w-full accent-blue-600"
                                />
                            </div>
                            <div className="w-20">
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    value={allocation.percentage}
                                    onChange={(e) => updateAllocation(index, 'percentage', Number.isFinite(Number.parseFloat(e.target.value)) ? Number(Number.parseFloat(e.target.value).toFixed(2)) : 0)}
                                    disabled={disabled}
                                    aria-invalid={!!fieldError}
                                    aria-describedby={fieldError ? `alloc-error-${index}` : undefined}
                                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:border-transparent ${
                                        fieldError
                                            ? 'border-red-500 bg-red-50 focus:ring-red-400 dark:bg-red-900/30'
                                            : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                                    }`}
                                />
                            </div>
                            <span className="w-12 text-right text-sm font-medium tabular-nums text-gray-700 dark:text-gray-300">
                                {allocation.percentage}%
                            </span>
                            {allocations.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeAllocation(index)}
                                    disabled={disabled}
                                    aria-label={`Remove ${allocation.asset} allocation`}
                                    className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        {fieldError && (
                            <p id={`alloc-error-${index}`} role="alert" className="mt-1 flex items-center text-xs text-red-600">
                                <AlertCircle className="mr-1 h-3 w-3 flex-shrink-0" />
                                {fieldError}
                            </p>
                        )}
                    </div>
                )
            })}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Total Allocation:
                    </span>
                    <span
                        className={`font-semibold tabular-nums ${
                            isValidTotal
                                ? 'text-green-600'
                                : deviation > 0
                                    ? 'text-red-600'
                                    : 'text-yellow-600'
                        }`}
                    >
                        {totalPercentage.toFixed(1)}%
                    </span>
                </div>

                <div
                    className="mb-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
                    role="progressbar"
                    aria-valuenow={Math.min(totalPercentage, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${totalPercentage.toFixed(1)}% of 100% allocated`}
                >
                    <div
                        className={`h-full rounded-full transition-all duration-200 ${
                            isValidTotal
                                ? 'bg-green-500'
                                : deviation > 0
                                    ? 'bg-red-500'
                                    : 'bg-yellow-400'
                        }`}
                        style={{ width: `${Math.min(totalPercentage, 100)}%` }}
                    />
                </div>

                <p
                    role="status"
                    className={`flex items-center text-xs ${
                        statusMessage.type === 'success'
                            ? 'text-green-600'
                            : statusMessage.type === 'error'
                                ? 'text-red-600'
                                : 'text-yellow-600'
                    }`}
                >
                    {statusMessage.type !== 'success' && (
                        <AlertCircle className="mr-1 h-3 w-3 flex-shrink-0" />
                    )}
                    {statusMessage.text}
                </p>
            </div>

            <button
                type="button"
                onClick={() => {}}
                disabled={!canSubmit}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
                {!isValidTotal
                    ? `Allocations must sum to 100% (currently ${totalPercentage.toFixed(1)}%)`
                    : hasAnyFieldError
                        ? 'Fix individual allocation errors'
                        : 'Submit Portfolio'}
            </button>
        </div>
    )
}
