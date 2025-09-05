import React from 'react'
import { Clock, ArrowRight, CheckCircle } from 'lucide-react'

const RebalanceHistory: React.FC = () => {
    const history = [
        {
            id: 1,
            timestamp: '2024-01-15 14:30',
            trigger: 'Threshold exceeded (8.2%)',
            trades: 3,
            gasUsed: '0.0234 XLM',
            status: 'completed'
        },
        {
            id: 2,
            timestamp: '2024-01-12 09:15',
            trigger: 'Scheduled rebalance',
            trades: 2,
            gasUsed: '0.0156 XLM',
            status: 'completed'
        },
        {
            id: 3,
            timestamp: '2024-01-08 16:45',
            trigger: 'Manual trigger',
            trades: 4,
            gasUsed: '0.0298 XLM',
            status: 'completed'
        }
    ]

    return (
        <div className="bg-white rounded-xl shadow-sm">
            <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Rebalance History</h2>
                <p className="text-sm text-gray-500 mt-1">Recent portfolio rebalancing activities</p>
            </div>

            <div className="divide-y divide-gray-100">
                {history.map((event) => (
                    <div key={event.id} className="p-6 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                                <div className="flex-shrink-0">
                                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                        <CheckCircle className="w-5 h-5 text-green-600" />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center space-x-2">
                                        <span className="font-medium text-gray-900">{event.trigger}</span>
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                            {event.trades} trades
                                        </span>
                                    </div>
                                    <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                                        <div className="flex items-center">
                                            <Clock className="w-4 h-4 mr-1" />
                                            {event.timestamp}
                                        </div>
                                        <span>Gas: {event.gasUsed}</span>
                                    </div>
                                </div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default RebalanceHistory