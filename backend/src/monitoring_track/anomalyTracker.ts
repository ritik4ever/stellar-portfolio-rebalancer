export interface AnomalyCounts {
    riskAlerts: { critical: number; warning: number; info: number }
    rebalanceBlocks: number
    priceFeedAnomalies: number
    circuitBreakerTriggers: number
    total: number
}

const counters: AnomalyCounts = {
    riskAlerts: { critical: 0, warning: 0, info: 0 },
    rebalanceBlocks: 0,
    priceFeedAnomalies: 0,
    circuitBreakerTriggers: 0,
    total: 0,
}

export function recordAnomaly(
    type: 'risk_alert' | 'rebalance_block' | 'price_feed_anomaly' | 'circuit_breaker_trigger',
    severity?: 'critical' | 'warning' | 'info',
): void {
    counters.total++
    switch (type) {
        case 'risk_alert':
            if (severity === 'critical') counters.riskAlerts.critical++
            else if (severity === 'warning') counters.riskAlerts.warning++
            else counters.riskAlerts.info++
            break
        case 'rebalance_block':
            counters.rebalanceBlocks++
            break
        case 'price_feed_anomaly':
            counters.priceFeedAnomalies++
            break
        case 'circuit_breaker_trigger':
            counters.circuitBreakerTriggers++
            break
    }
}

export function getAnomalySummary(): AnomalyCounts {
    return { ...counters }
}

export function resetAnomalyCounts(): void {
    counters.riskAlerts = { critical: 0, warning: 0, info: 0 }
    counters.rebalanceBlocks = 0
    counters.priceFeedAnomalies = 0
    counters.circuitBreakerTriggers = 0
    counters.total = 0
}
