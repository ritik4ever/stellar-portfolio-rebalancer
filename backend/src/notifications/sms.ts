import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import twilio from 'twilio'
import { deliverWithBackoff } from '../services/notificationDelivery.js'
import type { DeliveryBackoffPolicy } from '../config/notificationDeliveryConfig.js'

export interface SmsClient {
  messages: { create(input: { to: string; from: string; body: string }): Promise<unknown> }
}

export const normalizePhoneNumber = (phone: string): string => {
  const value = phone.trim()
  if (!/^\+[1-9]\d{7,14}$/.test(value)) throw new Error('Phone number must use E.164 format')
  return value
}

export const hashVerificationCode = (userId: string, phone: string, code: string): string =>
  createHash('sha256').update(`${userId}:${phone}:${code}`).digest('hex')

export const generateVerificationCode = (): string => randomInt(100000, 1000000).toString()

export function verifyCodeHash(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(actual, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createTwilioClient(): SmsClient | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  return sid && token ? twilio(sid, token) : null
}

export async function sendSms(
  client: SmsClient,
  input: { userId: string; phone: string; body: string; eventType: string },
  policy: DeliveryBackoffPolicy,
): Promise<void> {
  const from = process.env.TWILIO_FROM_NUMBER
  if (!from) throw new Error('Twilio sender is not configured')
  const to = normalizePhoneNumber(input.phone)
  await deliverWithBackoff({ provider: 'sms', userId: input.userId, eventType: input.eventType, policy }, () =>
    client.messages.create({ to, from, body: input.body.slice(0, 1500) }).then(() => undefined),
  )
}
