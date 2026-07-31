import React from 'react'
import DriftGauge, { DriftGaugeGrid } from '../components/DriftGauge'
import CorrelationHeatmap from '../components/CorrelationHeatmap'

const VisualTestComponents: React.FC = () => {
    return (
        <div className="p-8 space-y-16 bg-white dark:bg-slate-900 min-h-screen text-slate-900 dark:text-slate-100">
            <section id="drift-gauge-test">
                <h2 className="text-2xl font-bold mb-4">Drift Gauge</h2>
                <div className="flex flex-wrap gap-4">
                    <DriftGauge asset={{ id: '1', symbol: 'XLM', weight: 40, drift: 2.5, threshold: 5 }} size={96} />
                    <DriftGauge asset={{ id: '2', symbol: 'BTC', weight: 30, drift: 6.8, threshold: 5 }} size={96} />
                    <DriftGauge asset={{ id: '3', symbol: 'ETH', weight: 30, drift: -4.2, threshold: 5 }} size={96} />
                    <DriftGauge asset={{ id: '4', symbol: 'USDC', weight: 0, drift: 0, threshold: 5 }} size={96} />
                </div>
            </section>
            
            <section id="correlation-heatmap-test">
                <h2 className="text-2xl font-bold mb-4">Correlation Heatmap</h2>
                <CorrelationHeatmap 
                    assets={['XLM', 'BTC', 'ETH']} 
                    correlations={{
                        '30D': [
                            [1, 0.5, -0.2],
                            [0.5, 1, 0.8],
                            [-0.2, 0.8, 1]
                        ]
                    }} 
                />
            </section>
        </div>
    )
}

export default VisualTestComponents
