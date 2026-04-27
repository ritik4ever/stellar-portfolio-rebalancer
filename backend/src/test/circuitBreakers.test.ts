import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { RiskManagementService } from '../services/riskManagements.js'
import type { PricesMap } from '../types/index.js'

const makePrices = (entries: Record<string, { price: number, change?: number }>, timestamp: number): PricesMap =>
    Object.entries(entries).reduce<PricesMap>((acc, [asset, value]) => {
        acc[asset] = {
            price: value.price,
            change: value.change ?? 0,
            timestamp,
            source: 'external'
        }
        return acc
    }, {})

describe('RiskManagementService circuit breaker lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('triggers breaker, rejects rebalance during cooldown, and recovers after expiry', () => {
        const service = new RiskManagementService()
        const t0 = Date.now()

        service.updatePriceData(makePrices({ BTC: { price: 100 } }, t0))
        service.updatePriceData(makePrices({ BTC: { price: 130 } }, t0 + 1_000))

        const triggeredStatus = service.getCircuitBreakerStatus()
        expect(triggeredStatus.BTC?.isTriggered).toBe(true)

        const cooldownDecision = service.shouldAllowRebalance(
            { allocations: { BTC: 0.5, ETH: 0.5 } },
            makePrices({ BTC: { price: 130 }, ETH: { price: 50 } }, Date.now())
        )
        expect(cooldownDecision.allowed).toBe(false)
        expect(cooldownDecision.reasonCode).toBe('CIRCUIT_BREAKER_ACTIVE')

        vi.advanceTimersByTime(300_001)

        const recoveredStatus = service.getCircuitBreakerStatus()
        expect(recoveredStatus.BTC?.isTriggered).toBe(false)

        const recoveredDecision = service.shouldAllowRebalance(
            { allocations: { BTC: 0.5, ETH: 0.5 } },
            makePrices({ BTC: { price: 130 }, ETH: { price: 50 } }, Date.now())
        )
        expect(recoveredDecision.allowed).toBe(true)
        expect(recoveredDecision.reasonCode).toBe('OK')
    })

    it('supports concurrent circuit-breaker triggers across multiple assets', () => {
        const service = new RiskManagementService()
        const t0 = Date.now()

        service.updatePriceData(makePrices({
            BTC: { price: 100 },
            ETH: { price: 50 }
        }, t0))

        service.updatePriceData(makePrices({
            BTC: { price: 125 },
            ETH: { price: 65 }
        }, t0 + 1_000))

        const status = service.getCircuitBreakerStatus()
        expect(status.BTC?.isTriggered).toBe(true)
        expect(status.ETH?.isTriggered).toBe(true)
        expect(status.BTC?.triggeredAssets).toEqual(['BTC'])
        expect(status.ETH?.triggeredAssets).toEqual(['ETH'])
    })
})
