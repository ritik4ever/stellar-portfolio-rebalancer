import React from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface AllocationPieChartProps {
  data: Array<{ name: string; value: number; color: string }>
  loading?: boolean
}

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <div data-testid="allocation-pie-chart-skeleton" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-4 animate-pulse" />
        <div className="h-48 flex items-center justify-center mb-4">
          <div className="w-40 h-40 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Allocation</h3>
      <div className="h-64 flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 space-y-2">
        {data.map((asset, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: asset.color }} />
              <span className="text-sm text-gray-600 dark:text-gray-400">{asset.name}</span>
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{asset.value}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AllocationPieChart
