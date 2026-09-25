import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatSlackPayload, isValidSlackWebhookUrl, sendSlackNotification } from '../notifications/slack.js'
import { hashVerificationCode, sendSms, verifyCodeHash, type SmsClient } from '../notifications/sms.js'

const policy = { maxAttempts: 1, initialBackoffMs: 1, maxBackoffMs: 1, backoffMultiplier: 1 }
const alert = { userId: 'GUSER', eventType: 'riskChange', title: 'Risk alert', message: 'Risk is critical', timestamp: '2026-01-01T00:00:00.000Z', data: { level: 'critical' } }

describe('Slack notifications', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('validates Slack URLs and posts the expected Block Kit payload', async () => {
    expect(isValidSlackWebhookUrl('http://hooks.slack.com/services/a/b/c')).toBe(false)
    expect(isValidSlackWebhookUrl('https://example.com/services/a/b/c')).toBe(false)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await sendSlackNotification('https://hooks.slack.com/services/a/b/c', alert, policy, fetchMock as typeof fetch)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual(formatSlackPayload(alert))
    expect(body.blocks[1].text.text).toBe('Risk is critical')
  })

  it('surfaces webhook failures to the delivery pipeline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    await expect(sendSlackNotification('https://hooks.slack.com/services/a/b/c', alert, policy, fetchMock as typeof fetch)).rejects.toThrow('status 500')
  })
})

describe('Twilio SMS notifications', () => {
  beforeEach(() => { process.env.TWILIO_FROM_NUMBER = '+15550001111' })
  it('sends formatted messages through a mocked Twilio client', async () => {
    const create = vi.fn().mockResolvedValue({ sid: 'SM1' })
    await sendSms({ messages: { create } }, { userId: 'user', phone: '+15550002222', body: 'Critical risk alert', eventType: 'riskChange' }, policy)
    expect(create).toHaveBeenCalledWith({ to: '+15550002222', from: '+15550001111', body: 'Critical risk alert' })
  })

  it('covers confirmation hashes and provider failures', async () => {
    const hash = hashVerificationCode('user', '+15550002222', '123456')
    expect(verifyCodeHash(hash, hashVerificationCode('user', '+15550002222', '123456'))).toBe(true)
    expect(verifyCodeHash(hash, hashVerificationCode('user', '+15550002222', '654321'))).toBe(false)
    const client: SmsClient = { messages: { create: vi.fn().mockRejectedValue(new Error('Twilio unavailable')) } }
    await expect(sendSms(client, { userId: 'user', phone: '+15550002222', body: 'alert', eventType: 'riskChange' }, policy)).rejects.toThrow('Twilio unavailable')
  })
})
