import { deliverWithBackoff } from '../services/notificationDelivery.js'
import type { DeliveryBackoffPolicy } from '../config/notificationDeliveryConfig.js'

export interface SlackAlert {
  userId: string
  eventType: string
  title: string
  message: string
  data?: unknown
  timestamp: string
}

export function isValidSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com' && url.pathname.startsWith('/services/')
  } catch {
    return false
  }
}

export function formatSlackPayload(alert: SlackAlert): Record<string, unknown> {
  return {
    text: `*${alert.title}*\n${alert.message}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: alert.title.slice(0, 150) } },
      { type: 'section', text: { type: 'mrkdwn', text: alert.message } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Event: \`${alert.eventType}\` • ${alert.timestamp}` }] },
    ],
    metadata: { event_type: alert.eventType, event_payload: { data: alert.data ?? null } },
  }
}

export async function sendSlackNotification(
  webhookUrl: string,
  alert: SlackAlert,
  policy: DeliveryBackoffPolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isValidSlackWebhookUrl(webhookUrl)) throw new Error('Invalid Slack webhook URL')
  await deliverWithBackoff({ provider: 'slack', userId: alert.userId, eventType: alert.eventType, policy }, async () => {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(formatSlackPayload(alert)),
    })
    if (!response.ok) throw new Error(`Slack webhook responded with status ${response.status}`)
  })
}
