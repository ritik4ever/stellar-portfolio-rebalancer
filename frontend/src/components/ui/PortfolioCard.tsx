import React from 'react'

export interface PortfolioCardProps {
  title: string
  value: string | number
  change?: number
  subtitle?: string
  actions?: React.ReactNode
}

export const PortfolioCard: React.FC<PortfolioCardProps> = ({
  title,
  value,
  change,
  subtitle,
  actions,
}) => (
  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{value}</p>
        {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {typeof change === 'number' && (
          <span className={`text-xs font-medium ${change >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            {change >= 0 ? '+' : ''}{change}%
          </span>
        )}
        {actions && <div className="ml-3">{actions}</div>}
      </div>
    </div>
  </div>
)
