import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mockLoggerWarn = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
    debug: vi.fn(),
  },
  logAudit: vi.fn(),
}))

describe('operationalAlerts pipeline', () => {
  const originalSlackUrl = process.env.MONITORING_SLACK_WEBHOOK_URL
  const originalPagerDutyKey = process.env.PAGERDUTY_ROUTING_KEY

  beforeEach(() => {
    vi.restoreAllMocks()
    mockLoggerWarn.mockReset()
    mockLoggerError.mockReset()
    delete process.env.MONITORING_SLACK_WEBHOOK_URL
    delete process.env.PAGERDUTY_ROUTING_KEY
  })

  afterEach(() => {
    if (originalSlackUrl !== undefined) process.env.MONITORING_SLACK_WEBHOOK_URL = originalSlackUrl
    else delete process.env.MONITORING_SLACK_WEBHOOK_URL

    if (originalPagerDutyKey !== undefined) process.env.PAGERDUTY_ROUTING_KEY = originalPagerDutyKey
    else delete process.env.PAGERDUTY_ROUTING_KEY
  })

  it('warns when neither Slack nor PagerDuty is configured', async () => {
    const { sendOperationalAlert } = await import('../observability/operationalAlerts.js')
    await sendOperationalAlert('Worker failed', { reason: 'timeout' })

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[ALERT] No operational alert destination configured',
      expect.objectContaining({ summary: 'Worker failed', reason: 'timeout' }),
    )
  })

  it('posts alert to Slack webhook when configured', async () => {
    process.env.MONITORING_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test/123'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { sendOperationalAlert } = await import('../observability/operationalAlerts.js')
    await sendOperationalAlert('Consecutive cleanup failures', { consecutiveFailures: 3 })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test/123',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: expect.stringContaining('Consecutive cleanup failures'),
      }),
    )
  })

  it('posts alert to PagerDuty endpoint when configured', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'pd-routing-key-test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 202 }))

    const { sendOperationalAlert } = await import('../observability/operationalAlerts.js')
    await sendOperationalAlert('Dead-man switch tripped', { expectedIntervalMs: 60000 })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://events.pagerduty.com/v2/enqueue',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: expect.stringContaining('pd-routing-key-test'),
      }),
    )

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(sentBody.routing_key).toBe('pd-routing-key-test')
    expect(sentBody.event_action).toBe('trigger')
    expect(sentBody.payload.source).toBe('idempotency-cleanup-worker')
    expect(sentBody.payload.severity).toBe('error')
    expect(sentBody.payload.summary).toBe('Dead-man switch tripped')
  })

  it('logs error when alert dispatch fails without throwing', async () => {
    process.env.MONITORING_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test/fail'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    const { sendOperationalAlert } = await import('../observability/operationalAlerts.js')
    await expect(sendOperationalAlert('Test alert', {})).resolves.toBeUndefined()

    expect(mockLoggerError).toHaveBeenCalledWith(
      '[ALERT] Operational alert delivery failed',
      expect.objectContaining({ error: expect.stringContaining('Network error') }),
    )
  })
})
