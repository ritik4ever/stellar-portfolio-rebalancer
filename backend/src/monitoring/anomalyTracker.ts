import type { AnomalyThresholds, AnomalyCounts, AnomalyThresholdStatus, AnomalySummary } from './anomalyTracker.types.js'

export type { AnomalyCounts, AnomalyThresholds, AnomalyThresholdStatus, AnomalySummary }

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
    criticalRiskAlerts: 5,
    warningRiskAlerts: 10,
    infoRiskAlerts: 20,
    rebalanceBlocks: 5,
    priceFeedAnomalies: 3,
    circuitBreakerTriggers: 2,
    totalAnomalies: 25,
}

const KV_THRESHOLD_KEY = 'anomaly_detection_thresholds'

let activeThresholds: AnomalyThresholds = { ...DEFAULT_ANOMALY_THRESHOLDS }
let isLoadedFromDb = false

const counters: AnomalyCounts = {
    riskAlerts: { critical: 0, warning: 0, info: 0 },
    rebalanceBlocks: 0,
    priceFeedAnomalies: 0,
    circuitBreakerTriggers: 0,
    total: 0,
}

function loadStoredThresholdsIfNeeded(): void {
    if (isLoadedFromDb) return
    isLoadedFromDb = true
    try {
        import('../services/databaseService.js').then(({ databaseService }) => {
            const storedJson = databaseService.getKvValue(KV_THRESHOLD_KEY)
            if (storedJson) {
                const parsed = JSON.parse(storedJson)
                activeThresholds = { ...DEFAULT_ANOMALY_THRESHOLDS, ...parsed }
            }
        }).catch(() => {})
    } catch {
        // Fall back to default thresholds if database is unavailable
    }
}

function persistThresholds(): void {
    try {
        import('../services/databaseService.js').then(({ databaseService }) => {
            databaseService.setKvValue(KV_THRESHOLD_KEY, JSON.stringify(activeThresholds))
        }).catch(() => {})
    } catch {
        // Ignore persistence errors in uninitialized DB or mock test environments
    }
}

export function getAnomalyThresholds(): AnomalyThresholds {
    loadStoredThresholdsIfNeeded()
    return { ...activeThresholds }
}

export function setAnomalyThresholds(newThresholds: Partial<AnomalyThresholds>): AnomalyThresholds {
    loadStoredThresholdsIfNeeded()
    activeThresholds = {
        ...activeThresholds,
        ...newThresholds,
    }
    persistThresholds()
    return { ...activeThresholds }
}

export function resetAnomalyThresholds(): AnomalyThresholds {
    activeThresholds = { ...DEFAULT_ANOMALY_THRESHOLDS }
    persistThresholds()
    return { ...activeThresholds }
}

export function checkAnomalyThresholds(): AnomalyThresholdStatus {
    const thresholds = getAnomalyThresholds()
    const details: Record<string, { count: number; threshold: number; exceeded: boolean }> = {
        criticalRiskAlerts: {
            count: counters.riskAlerts.critical,
            threshold: thresholds.criticalRiskAlerts,
            exceeded: counters.riskAlerts.critical >= thresholds.criticalRiskAlerts && thresholds.criticalRiskAlerts > 0,
        },
        warningRiskAlerts: {
            count: counters.riskAlerts.warning,
            threshold: thresholds.warningRiskAlerts,
            exceeded: counters.riskAlerts.warning >= thresholds.warningRiskAlerts && thresholds.warningRiskAlerts > 0,
        },
        infoRiskAlerts: {
            count: counters.riskAlerts.info,
            threshold: thresholds.infoRiskAlerts,
            exceeded: counters.riskAlerts.info >= thresholds.infoRiskAlerts && thresholds.infoRiskAlerts > 0,
        },
        rebalanceBlocks: {
            count: counters.rebalanceBlocks,
            threshold: thresholds.rebalanceBlocks,
            exceeded: counters.rebalanceBlocks >= thresholds.rebalanceBlocks && thresholds.rebalanceBlocks > 0,
        },
        priceFeedAnomalies: {
            count: counters.priceFeedAnomalies,
            threshold: thresholds.priceFeedAnomalies,
            exceeded: counters.priceFeedAnomalies >= thresholds.priceFeedAnomalies && thresholds.priceFeedAnomalies > 0,
        },
        circuitBreakerTriggers: {
            count: counters.circuitBreakerTriggers,
            threshold: thresholds.circuitBreakerTriggers,
            exceeded: counters.circuitBreakerTriggers >= thresholds.circuitBreakerTriggers && thresholds.circuitBreakerTriggers > 0,
        },
        totalAnomalies: {
            count: counters.total,
            threshold: thresholds.totalAnomalies,
            exceeded: counters.total >= thresholds.totalAnomalies && thresholds.totalAnomalies > 0,
        },
    }

    const exceededMetrics = Object.keys(details).filter((key) => details[key].exceeded)

    return {
        isExceeded: exceededMetrics.length > 0,
        exceededMetrics,
        details,
    }
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

export function getAnomalySummary(): AnomalySummary {
    const status = checkAnomalyThresholds()
    return {
        riskAlerts: { ...counters.riskAlerts },
        rebalanceBlocks: counters.rebalanceBlocks,
        priceFeedAnomalies: counters.priceFeedAnomalies,
        circuitBreakerTriggers: counters.circuitBreakerTriggers,
        total: counters.total,
        thresholds: getAnomalyThresholds(),
        exceeded: status.isExceeded,
        exceededMetrics: status.exceededMetrics,
        thresholdStatus: status,
    }
}

export function resetAnomalyCounts(): void {
    counters.riskAlerts = { critical: 0, warning: 0, info: 0 }
    counters.rebalanceBlocks = 0
    counters.priceFeedAnomalies = 0
    counters.circuitBreakerTriggers = 0
    counters.total = 0
}


