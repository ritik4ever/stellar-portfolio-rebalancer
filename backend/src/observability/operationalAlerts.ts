import { logger } from '../utils/logger.js'

export async function sendOperationalAlert(summary: string, details: Record<string, unknown>): Promise<void> {
  const slackUrl = process.env.MONITORING_SLACK_WEBHOOK_URL
  const pagerDutyKey = process.env.PAGERDUTY_ROUTING_KEY
  const requests: Promise<unknown>[] = []
  const post = async (url: string, body: unknown): Promise<void> => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Operational alert endpoint returned ${response.status}`)
  }
  if (slackUrl) requests.push(post(slackUrl, { text: `:rotating_light: *${summary}*\n\`\`\`${JSON.stringify(details)}\`\`\`` }))
  if (pagerDutyKey) requests.push(post('https://events.pagerduty.com/v2/enqueue', { routing_key: pagerDutyKey, event_action: 'trigger', payload: { summary, source: 'idempotency-cleanup-worker', severity: 'error', custom_details: details } }))
  if (requests.length === 0) logger.warn('[ALERT] No operational alert destination configured', { summary, ...details })
  const results = await Promise.allSettled(requests)
  results.forEach((result) => { if (result.status === 'rejected') logger.error('[ALERT] Operational alert delivery failed', { error: String(result.reason) }) })
}
