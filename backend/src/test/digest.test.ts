import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'

const mocks = vi.hoisted(() => {
  const mockReflectorPrices = {
    XLM: { price: 0.35, change: 5.2, timestamp: Date.now(), source: 'test' },
    BTC: { price: 110000, change: -2.1, timestamp: Date.now(), source: 'test' },
    ETH: { price: 4200, change: 1.8, timestamp: Date.now(), source: 'test' },
    USDC: { price: 1.0, change: 0.01, timestamp: Date.now(), source: 'test' },
  }

  const mockGetCurrentPrices = vi.fn().mockResolvedValue(mockReflectorPrices)
  const mockSendRawEmail = vi.fn()
  const mockGetAllNotificationPreferences = vi.fn()
  const mockGetUserPortfolios = vi.fn()
  const mockGetAutoRebalancesSince = vi.fn()
  const mockGetAnalyticsInRange = vi.fn()

  return {
    mockReflectorPrices,
    mockGetCurrentPrices,
    mockSendRawEmail,
    mockGetAllNotificationPreferences,
    mockGetUserPortfolios,
    mockGetAutoRebalancesSince,
    mockGetAnalyticsInRange,
  }
})

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/reflector.js', () => ({
  ReflectorService: class {
    getCurrentPrices = mocks.mockGetCurrentPrices
  },
}))

vi.mock('../services/notificationService.js', () => ({
  notificationService: {
    sendRawEmail: mocks.mockSendRawEmail,
  },
  NotificationService: class {
    static verifyUnsubscribeToken(userId: string, token: string): boolean {
      const secret = process.env.UNSUBSCRIBE_SECRET || process.env.SMTP_PASS || 'stellar-unsubscribe-key'
      const expected = createHmac('sha256', secret).update(userId).digest('hex')
      return token === expected
    }
  },
}))

vi.mock('../db/notificationDb.js', () => ({
  dbGetAllNotificationPreferences: mocks.mockGetAllNotificationPreferences,
}))

vi.mock('../services/portfolioStorage.js', () => ({
  portfolioStorage: {
    getUserPortfolios: mocks.mockGetUserPortfolios,
  },
}))

vi.mock('../services/databaseService.js', () => ({
  databaseService: {
    getAutoRebalancesSince: mocks.mockGetAutoRebalancesSince,
  },
}))

vi.mock('../services/analyticsService.js', () => ({
  analyticsService: {
    getAnalyticsInRange: mocks.mockGetAnalyticsInRange,
  },
}))

const mockPortfolio = {
  id: 'portfolio-1',
  userAddress: 'user-1',
  name: 'My Test Portfolio',
  allocations: { XLM: 50, BTC: 30, ETH: 20 },
  threshold: 5,
  balances: { XLM: 1000, BTC: 0.1, ETH: 1.5 },
  totalValue: 0,
  createdAt: '2025-01-01T00:00:00.000Z',
  lastRebalance: '2025-01-01T00:00:00.000Z',
  version: 1,
}

describe('Digest Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.UNSUBSCRIBE_SECRET = 'test-digest-secret-key'
    process.env.API_URL = 'https://test.api.com'
  })

  afterEach(() => {
    delete process.env.UNSUBSCRIBE_SECRET
    delete process.env.API_URL
  })

  describe('sendDigests', () => {
    it('skips when no eligible users', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      expect(mocks.mockSendRawEmail).not.toHaveBeenCalled()
    })

    it('skips users with email disabled', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: false, emailAddress: 'test@test.com', digestMode: 'weekly' } as any,
      ])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      expect(mocks.mockSendRawEmail).not.toHaveBeenCalled()
    })

    it('skips users with no email address', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: undefined, digestMode: 'weekly' } as any,
      ])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      expect(mocks.mockSendRawEmail).not.toHaveBeenCalled()
    })

    it('skips users whose digestMode differs from frequency', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: 'test@test.com', digestMode: 'daily' } as any,
      ])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      expect(mocks.mockSendRawEmail).not.toHaveBeenCalled()
    })

    it('sends digest to eligible users with matching digestMode', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: 'test@test.com', digestMode: 'weekly' } as any,
      ])
      mocks.mockGetUserPortfolios.mockReturnValue([mockPortfolio])
      mocks.mockGetAutoRebalancesSince.mockReturnValue([{ id: 'r-1', trades: 3 } as any])
      mocks.mockGetAnalyticsInRange.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      expect(mocks.mockSendRawEmail).toHaveBeenCalledTimes(1)
      expect(mocks.mockSendRawEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@test.com',
          subject: expect.stringContaining('Weekly Portfolio Summary'),
        }),
      )
    })

    it('sends digest to multiple eligible users', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: 'a@test.com', digestMode: 'daily' } as any,
        { userId: 'user-2', emailEnabled: true, emailAddress: 'b@test.com', digestMode: 'daily' } as any,
      ])
      mocks.mockGetUserPortfolios.mockReturnValue([mockPortfolio])
      mocks.mockGetAutoRebalancesSince.mockReturnValue([])
      mocks.mockGetAnalyticsInRange.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('daily')

      expect(mocks.mockSendRawEmail).toHaveBeenCalledTimes(2)
    })

    it('skips users with no portfolios', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: 'test@test.com', digestMode: 'monthly' } as any,
      ])
      mocks.mockGetUserPortfolios.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('monthly')

      expect(mocks.mockSendRawEmail).not.toHaveBeenCalled()
    })

    it('handles errors gracefully per user without breaking others', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-error', emailEnabled: true, emailAddress: 'a@test.com', digestMode: 'weekly' } as any,
        { userId: 'user-ok', emailEnabled: true, emailAddress: 'b@test.com', digestMode: 'weekly' } as any,
      ])
      mocks.mockGetUserPortfolios
        .mockImplementationOnce(() => { throw new Error('DB error') })
        .mockReturnValue([mockPortfolio])
      mocks.mockGetAutoRebalancesSince.mockReturnValue([])
      mocks.mockGetAnalyticsInRange.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      expect(mocks.mockSendRawEmail).toHaveBeenCalledTimes(1)
      expect(mocks.mockSendRawEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'b@test.com' }),
      )
    })
  })

  describe('email content', () => {
    it('includes total value and change in HTML', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: 'test@test.com', digestMode: 'weekly' } as any,
      ])
      mocks.mockGetUserPortfolios.mockReturnValue([mockPortfolio])
      mocks.mockGetAutoRebalancesSince.mockReturnValue([{ id: 'r-1', trades: 2 } as any])
      mocks.mockGetAnalyticsInRange.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      const callArgs = mocks.mockSendRawEmail.mock.calls[0][0]
      expect(callArgs.html).toContain('Total Value')
      expect(callArgs.html).toContain('This Week')
      expect(callArgs.html).toContain('My Test Portfolio')
      expect(callArgs.html).toContain('Unsubscribe from digest emails')
      expect(callArgs.html).toContain('/api/notifications/unsubscribe')
    })

    it('includes unsubscribe URL in text version', async () => {
      mocks.mockGetAllNotificationPreferences.mockReturnValue([
        { userId: 'user-1', emailEnabled: true, emailAddress: 'test@test.com', digestMode: 'weekly' } as any,
      ])
      mocks.mockGetUserPortfolios.mockReturnValue([mockPortfolio])
      mocks.mockGetAutoRebalancesSince.mockReturnValue([])
      mocks.mockGetAnalyticsInRange.mockReturnValue([])

      const { sendDigests } = await import('../notifications/digest.js')
      await sendDigests('weekly')

      const callArgs = mocks.mockSendRawEmail.mock.calls[0][0]
      expect(callArgs.text).toContain('Unsubscribe:')
      expect(callArgs.text).toContain('/api/notifications/unsubscribe')
      expect(callArgs.text).toContain('Week Portfolio Summary')
    })
  })

  describe('verifyUnsubscribeToken', () => {
    it('verifies a token generated with the same secret', async () => {
      const { NotificationService } = await import('../services/notificationService.js')
      const userId = 'user-1'
      const secret = 'test-digest-secret-key'
      const token = createHmac('sha256', secret).update(userId).digest('hex')

      const result = NotificationService.verifyUnsubscribeToken(userId, token)
      expect(result).toBe(true)
    })

    it('rejects a token generated with a different secret', async () => {
      const { NotificationService } = await import('../services/notificationService.js')
      const userId = 'user-1'
      const wrongToken = createHmac('sha256', 'wrong-secret').update(userId).digest('hex')

      const result = NotificationService.verifyUnsubscribeToken(userId, wrongToken)
      expect(result).toBe(false)
    })

    it('rejects a malformed token', async () => {
      const { NotificationService } = await import('../services/notificationService.js')
      const result = NotificationService.verifyUnsubscribeToken('user-1', 'not-a-valid-hex-token!!!')
      expect(result).toBe(false)
    })

    it('rejects empty token', async () => {
      const { NotificationService } = await import('../services/notificationService.js')
      const result = NotificationService.verifyUnsubscribeToken('user-1', '')
      expect(result).toBe(false)
    })

    it('verifies token using the imported constant when env is set', async () => {
      const { NotificationService } = await import('../services/notificationService.js')
      const userId = 'user-1'
      const secret = 'test-digest-secret-key'
      const token = createHmac('sha256', secret).update(userId).digest('hex')

      const result = NotificationService.verifyUnsubscribeToken(userId, token)
      expect(result).toBe(true)
    })
  })
})
