import type { NotificationEventKey } from './notificationPreferences.js'

// ─────────────────────────────────────────────
// Template data shapes per event type
// ─────────────────────────────────────────────

export interface RebalanceData {
  portfolioId: string
  trades: number
  gasUsed: string
  trigger: string
}

export interface CircuitBreakerData {
  asset: string
  priceChange: string
  cooldownMinutes: number
}

export interface PriceMovementData {
  asset: string
  priceChange: string
  direction: 'increased' | 'decreased'
}

export interface RiskChangeData {
  portfolioId: string
  oldLevel: string
  newLevel: string
  /** Optional: breach details when auto-pause was triggered by a CVaR/VaR threshold. */
  autoPause?: {
    reason: 'VAR_BREACH' | 'CVAR_BREACH'
    /** Measured value as a percentage string e.g. "14.23%" */
    measuredValue: string
    /** Threshold as a percentage string e.g. "12.00%" */
    threshold: string
    /** ISO string of when the pause expires */
    pausedUntil: string
  }
}

export type NotificationTemplateData =
  | { eventType: 'rebalance'; data: RebalanceData }
  | { eventType: 'circuitBreaker'; data: CircuitBreakerData }
  | { eventType: 'priceMovement'; data: PriceMovementData }
  | { eventType: 'riskChange'; data: RiskChangeData }

// ─────────────────────────────────────────────
// Template registry
// ─────────────────────────────────────────────

type TemplateEntry<D> = {
  title: (data: D) => string
  message: (data: D) => string
}

const templates: {
  rebalance: TemplateEntry<RebalanceData>
  circuitBreaker: TemplateEntry<CircuitBreakerData>
  priceMovement: TemplateEntry<PriceMovementData>
  riskChange: TemplateEntry<RiskChangeData>
} = {
  rebalance: {
    title: () => 'Portfolio Rebalanced',
    message: (d) =>
      `Your portfolio has been rebalanced. ${d.trades} trade${d.trades !== 1 ? 's' : ''} executed with ${d.gasUsed} gas used.`,
  },
  circuitBreaker: {
    title: () => 'Circuit Breaker Triggered',
    message: (d) =>
      `Trading paused: ${d.asset} moved ${d.priceChange}%. Cooldown: ${d.cooldownMinutes} minutes.`,
  },
  priceMovement: {
    title: () => 'Large Price Movement Detected',
    message: (d) => `${d.asset} has ${d.direction} by ${d.priceChange}%.`,
  },
  riskChange: {
    title: (d) => d.autoPause ? 'Rebalancing Auto-Paused: Risk Threshold Breached' : 'Portfolio Risk Level Changed',
    message: (d) => {
      if (d.autoPause) {
        const metricLabel = d.autoPause.reason === 'VAR_BREACH' ? 'VaR(95)' : 'CVaR(95)'
        const pauseDate = new Date(d.autoPause.pausedUntil).toLocaleString('en-US', { timeZoneName: 'short' })
        return (
          `Scheduled rebalancing for portfolio ${d.portfolioId} has been automatically paused because the ` +
          `${metricLabel} limit was exceeded (measured: ${d.autoPause.measuredValue}, threshold: ${d.autoPause.threshold}). ` +
          `Rebalancing is suspended until ${pauseDate}. ` +
          `Risk level: ${d.oldLevel} → ${d.newLevel}. ` +
          `Review your portfolio and market conditions before resuming.`
        )
      }
      return `Your portfolio risk level changed from ${d.oldLevel} to ${d.newLevel}.`
    },
  },
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Builds the title and message for a notification from the central template registry.
 * Use this instead of writing inline strings at call sites.
 */
export function buildNotificationPayload(
  userId: string,
  input: NotificationTemplateData,
): { userId: string; eventType: NotificationEventKey; title: string; message: string; data: unknown; timestamp: string } {
  const tpl = templates[input.eventType] as TemplateEntry<typeof input.data>
  return {
    userId,
    eventType: input.eventType,
    title: tpl.title(input.data as any),
    message: tpl.message(input.data as any),
    data: input.data,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Returns a sample payload for a given event type. Used by the debug test endpoint
 * so test content is also driven by the registry rather than duplicated inline.
 */
export function buildTestNotificationPayload(
  userId: string,
  eventType: NotificationEventKey,
): ReturnType<typeof buildNotificationPayload> {
  const sampleData: Record<NotificationEventKey, NotificationTemplateData> = {
    rebalance: {
      eventType: 'rebalance',
      data: { portfolioId: 'test-portfolio-123', trades: 3, gasUsed: '0.0234 XLM', trigger: 'manual' },
    },
    circuitBreaker: {
      eventType: 'circuitBreaker',
      data: { asset: 'BTC', priceChange: '22.5', cooldownMinutes: 5 },
    },
    priceMovement: {
      eventType: 'priceMovement',
      data: { asset: 'ETH', priceChange: '12.34', direction: 'increased' },
    },
    riskChange: {
      eventType: 'riskChange',
      data: { portfolioId: 'test-portfolio-123', oldLevel: 'medium', newLevel: 'high' },
    },
  }

  return buildNotificationPayload(userId, sampleData[eventType])
}
