import React from 'react'

interface DriftGaugeProps {
  drift: number
  threshold: number
  label?: string
}

const DriftGauge: React.FC<DriftGaugeProps> = ({ drift, threshold, label }) => {
  const percentOfThreshold = threshold > 0 ? Math.min(Math.abs(drift) / threshold, 1) : 0
  const exceedsThreshold = Math.abs(drift) > threshold

  const getColor = () => {
    if (percentOfThreshold >= 1) return 'bg-red-500'
    if (percentOfThreshold >= 0.75) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getTextColor = () => {
    if (percentOfThreshold >= 1) return 'text-red-600 dark:text-red-400'
    if (percentOfThreshold >= 0.75) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-green-600 dark:text-green-400'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm" data-testid="drift-gauge">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label || 'Portfolio Drift'}</span>
        <span className={`text-lg font-bold ${getTextColor()}`}>
          {drift >= 0 ? '+' : ''}{drift.toFixed(1)}%
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${getColor()}`}
          style={{ width: `${percentOfThreshold * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-400">0%</span>
        <span className="text-xs text-gray-400">Threshold: {threshold}%</span>
      </div>
      {exceedsThreshold && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400 font-medium">
          Drift exceeds threshold — rebalancing recommended
        </p>
      )}
    </div>
  )
}

export default DriftGauge
