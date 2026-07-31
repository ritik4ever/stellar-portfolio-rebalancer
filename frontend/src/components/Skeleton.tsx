import React from 'react'

export type SkeletonVariant = 'dashboard' | 'price-feed' | 'history-table'

interface SkeletonProps {
  variant: SkeletonVariant
}

const DashboardSkeleton: React.FC = () => (
  <div className="grid lg:grid-cols-3 gap-6">
    <div className="lg:col-span-2 space-y-6">
      <div data-testid="skeleton-dashboard-value" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
          <div className="flex items-center space-x-2">
            <div className="w-32 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
            <div className="w-24 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
          </div>
        </div>
        <div className="mb-4 space-y-2">
          <div className="w-40 h-8 bg-gray-300 dark:bg-gray-700 rounded" />
          <div className="w-32 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
        </div>
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} data-testid={`skeleton-asset-card-${i}`} className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700 animate-pulse">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center">
                <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-full bg-gray-300 dark:bg-gray-700" />
                <div className="ml-2 sm:ml-3 space-y-1 sm:space-y-2">
                  <div className="w-16 sm:w-24 h-3 sm:h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                  <div className="w-20 sm:w-32 h-2 sm:h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>
              </div>
              <div className="w-10 sm:w-12 h-5 sm:h-6 bg-gray-300 dark:bg-gray-700 rounded" />
            </div>
            <div className="space-y-1 sm:space-y-2">
              {[1, 2, 3].map((row) => (
                <div key={row} className="flex justify-between">
                  <div className="w-10 sm:w-12 h-2 sm:h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                  <div className="w-16 sm:w-20 h-2 sm:h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div data-testid="skeleton-history-table" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    </div>

    <div className="space-y-6">
      <div data-testid="skeleton-allocation" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-4" />
        <div className="h-48 flex items-center justify-center mb-4">
          <div className="w-40 h-40 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex justify-between">
              <div className="w-16 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
              <div className="w-12 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>

      <div data-testid="skeleton-price-feed" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-4" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="w-16 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                <div className="w-12 h-5 bg-gray-300 dark:bg-gray-600 rounded" />
              </div>
              <div className="w-24 h-6 bg-gray-300 dark:bg-gray-600 rounded mb-2" />
              <div className="w-16 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
)

const PriceFeedSkeleton: React.FC = () => (
  <div data-testid="skeleton-price-feed-only" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
    <div className="flex items-center justify-between mb-4">
      <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
      <div className="w-24 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="w-16 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
            <div className="w-12 h-5 bg-gray-300 dark:bg-gray-600 rounded" />
          </div>
          <div className="w-24 h-6 bg-gray-300 dark:bg-gray-600 rounded mb-2" />
          <div className="w-16 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
        </div>
      ))}
    </div>
  </div>
)

const HistoryTableSkeleton: React.FC = () => (
  <div data-testid="skeleton-history-only" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 animate-pulse">
    <div className="flex items-center justify-between mb-4">
      <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
      <div className="w-24 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
    </div>
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center space-x-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600" />
          <div className="flex-1 space-y-2">
            <div className="w-3/4 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
            <div className="w-1/2 h-3 bg-gray-300 dark:bg-gray-600 rounded" />
          </div>
        </div>
      ))}
    </div>
  </div>
)

const Skeleton: React.FC<SkeletonProps> = ({ variant }) => {
  switch (variant) {
    case 'dashboard':
      return <DashboardSkeleton />
    case 'price-feed':
      return <PriceFeedSkeleton />
    case 'history-table':
      return <HistoryTableSkeleton />
    default:
      return <DashboardSkeleton />
  }
}

export default Skeleton
