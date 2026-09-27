export interface AnomalyCounts {
    riskAlerts: { critical: number; warning: number; info: number }
    rebalanceBlocks: number
    priceFeedAnomalies: number
    circuitBreakerTriggers: number
    total: number
}

export interface AnomalyThresholds {
    criticalRiskAlerts: number
    warningRiskAlerts: number
    infoRiskAlerts: number
    rebalanceBlocks: number
    priceFeedAnomalies: number
    circuitBreakerTriggers: number
    totalAnomalies: number
}

export interface AnomalyThresholdStatus {
    isExceeded: boolean
    exceededMetrics: string[]
    details: Record<string, { count: number; threshold: number; exceeded: boolean }>
}

export interface AnomalySummary extends AnomalyCounts {
    thresholds: AnomalyThresholds
    exceeded: boolean
    exceededMetrics: string[]
    thresholdStatus: AnomalyThresholdStatus
}
