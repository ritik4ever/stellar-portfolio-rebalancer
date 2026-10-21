import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordTradeSlippage } from '../observability/metrics.js'

describe('Per-trade slippage telemetry (#1178)', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('emits slippage metric with portfolio bucket and asset pair labels', () => {
        const observeSpy = vi.spyOn(require('../observability/metrics.js').tradeSlippageBps, 'observe')
        const priceSpy = vi.spyOn(require('../observability/metrics.js').tradeExecutionPrice, 'observe')

        recordTradeSlippage({
            portfolioId: 'portfolio-123',
            fromAsset: 'BTC',
            toAsset: 'ETH',
            slippageBps: 25,
            executionPrice: 50000
        })

        expect(observeSpy).toHaveBeenCalledWith(
            { portfolio_bucket: expect.any(String), asset_pair: 'BTC/ETH' },
            25
        )
        expect(priceSpy).toHaveBeenCalledWith(
            { portfolio_bucket: expect.any(String), asset_pair: 'BTC/ETH' },
            50000
        )
    })

    it('handles missing portfolioId gracefully', () => {
        const observeSpy = vi.spyOn(require('../observability/metrics.js').tradeSlippageBps, 'observe')

        recordTradeSlippage({
            portfolioId: 'unknown',
            fromAsset: 'XLM',
            toAsset: 'USDC',
            slippageBps: 10,
            executionPrice: 1
        })

        expect(observeSpy).toHaveBeenCalled()
    })

    it('does not block trade execution on metric emission failure', () => {
        const observeSpy = vi.spyOn(require('../observability/metrics.js').tradeSlippageBps, 'observe').mockImplementation(() => {
            throw new Error('Metrics system unavailable')
        })

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        // Should not throw
        expect(() => {
            recordTradeSlippage({
                portfolioId: 'portfolio-123',
                fromAsset: 'BTC',
                toAsset: 'ETH',
                slippageBps: 25,
                executionPrice: 50000
            })
        }).not.toThrow()

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[METRICS]',
            'Failed to record trade slippage:',
            expect.any(Error)
        )

        consoleErrorSpy.mockRestore()
    })

    it('clamps negative slippage to zero', () => {
        const observeSpy = vi.spyOn(require('../observability/metrics.js').tradeSlippageBps, 'observe')

        recordTradeSlippage({
            portfolioId: 'portfolio-123',
            fromAsset: 'BTC',
            toAsset: 'ETH',
            slippageBps: -5,
            executionPrice: 50000
        })

        expect(observeSpy).toHaveBeenCalledWith(
            expect.any(Object),
            0 // Clamped to zero
        )
    })

    it('skips execution price metric when price is zero or negative', () => {
        const priceSpy = vi.spyOn(require('../observability/metrics.js').tradeExecutionPrice, 'observe')

        recordTradeSlippage({
            portfolioId: 'portfolio-123',
            fromAsset: 'BTC',
            toAsset: 'ETH',
            slippageBps: 25,
            executionPrice: 0
        })

        expect(priceSpy).not.toHaveBeenCalled()
    })
})
