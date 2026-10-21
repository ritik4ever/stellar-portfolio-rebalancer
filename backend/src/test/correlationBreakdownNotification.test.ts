import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn().mockResolvedValue(undefined)
vi.mock('../services/notificationService.js', () => ({ notificationService: { notify } }))
vi.mock('../services/assetRegistryService.js', () => ({ assetRegistryService: { getSymbols: () => ['BTC', 'ETH'] } }))
vi.mock('../config/volatilityConfig.js', () => ({ getVolatilityThresholdFraction: () => 0.1 }))
vi.mock('../services/portfolioStorage.js', () => ({ portfolioStorage: {} }))

describe('correlation breakdown notifications', () => {
  beforeEach(() => notify.mockClear())
  it('includes affected pairs and correlation delta', async () => {
    const { RiskManagementService } = await import('../services/riskManagements.js')
    const service = new RiskManagementService()
    await service.detectAndNotifyCorrelationBreakdown('user-1', 'portfolio-1', { BTC: { BTC: 1, ETH: 0.9 }, ETH: { BTC: 0.9, ETH: 1 } })
    await service.detectAndNotifyCorrelationBreakdown('user-1', 'portfolio-1', { BTC: { BTC: 1, ETH: 0.1 }, ETH: { BTC: 0.1, ETH: 1 } })
    expect(notify).toHaveBeenCalledOnce()
    expect(notify.mock.calls[0][0]).toMatchObject({ eventType: 'correlation_breakdown', data: { affectedPairs: [{ assetA: 'BTC', assetB: 'ETH', delta: -0.8 }] } })
  })
})
