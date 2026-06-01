import { beforeEach, describe, expect, it } from 'vitest'

describe('anomalyTracker', () => {
    beforeEach(async () => {
        const { resetAnomalyCounts } = await import('../monitoring/anomalyTracker.js')
        resetAnomalyCounts()
    })

    it('starts with zero counts', async () => {
        const { getAnomalySummary } = await import('../monitoring/anomalyTracker.js')
        const summary = getAnomalySummary()
        expect(summary.total).toBe(0)
        expect(summary.riskAlerts.critical).toBe(0)
        expect(summary.riskAlerts.warning).toBe(0)
        expect(summary.riskAlerts.info).toBe(0)
        expect(summary.rebalanceBlocks).toBe(0)
        expect(summary.priceFeedAnomalies).toBe(0)
        expect(summary.circuitBreakerTriggers).toBe(0)
    })

    it('records risk alert anomalies by severity', async () => {
        const { recordAnomaly, getAnomalySummary } = await import('../monitoring/anomalyTracker.js')
        recordAnomaly('risk_alert', 'critical')
        recordAnomaly('risk_alert', 'warning')
        recordAnomaly('risk_alert', 'info')
        recordAnomaly('risk_alert', 'critical')

        const summary = getAnomalySummary()
        expect(summary.riskAlerts.critical).toBe(2)
        expect(summary.riskAlerts.warning).toBe(1)
        expect(summary.riskAlerts.info).toBe(1)
        expect(summary.total).toBe(4)
    })

    it('records rebalance block anomalies', async () => {
        const { recordAnomaly, getAnomalySummary } = await import('../monitoring/anomalyTracker.js')
        recordAnomaly('rebalance_block')
        recordAnomaly('rebalance_block')

        const summary = getAnomalySummary()
        expect(summary.rebalanceBlocks).toBe(2)
        expect(summary.total).toBe(2)
    })

    it('records price feed anomalies', async () => {
        const { recordAnomaly, getAnomalySummary } = await import('../monitoring/anomalyTracker.js')
        recordAnomaly('price_feed_anomaly')

        const summary = getAnomalySummary()
        expect(summary.priceFeedAnomalies).toBe(1)
        expect(summary.total).toBe(1)
    })

    it('records circuit breaker trigger anomalies', async () => {
        const { recordAnomaly, getAnomalySummary } = await import('../monitoring/anomalyTracker.js')
        recordAnomaly('circuit_breaker_trigger')

        const summary = getAnomalySummary()
        expect(summary.circuitBreakerTriggers).toBe(1)
        expect(summary.total).toBe(1)
    })

    it('resets all counts', async () => {
        const { recordAnomaly, getAnomalySummary, resetAnomalyCounts } = await import('../monitoring/anomalyTracker.js')
        recordAnomaly('risk_alert', 'critical')
        recordAnomaly('rebalance_block')
        expect(getAnomalySummary().total).toBe(2)

        resetAnomalyCounts()
        const summary = getAnomalySummary()
        expect(summary.total).toBe(0)
        expect(summary.riskAlerts.critical).toBe(0)
        expect(summary.rebalanceBlocks).toBe(0)
    })

    it('getAnomalySummary returns a copy, not a reference', async () => {
        const { getAnomalySummary, recordAnomaly } = await import('../monitoring/anomalyTracker.js')
        const summary1 = getAnomalySummary()
        recordAnomaly('risk_alert', 'critical')
        const summary2 = getAnomalySummary()
        expect(summary1.total).toBe(0)
        expect(summary2.total).toBe(1)
    })
})
