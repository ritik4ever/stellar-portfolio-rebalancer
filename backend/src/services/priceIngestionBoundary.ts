import type { PriceDataSource } from '../types/index.js'

export type PriceIngestionResult = 'accepted' | 'rejected'

export type PriceIngestionReasonCode =
    | 'FRESH'
    | 'FRESH_AT_LIMIT'
    | 'STALE_QUOTE'
    | 'OLDER_LEDGER'
    | 'INVALID_QUOTE'

export interface AcceptedReflectorQuote {
    source: PriceDataSource
    price: number
    ledger?: number
}

export interface ReflectorQuoteUpdateInput {
    asset: string
    source: PriceDataSource
    price: number
    timestamp: number
    ledger?: number
    maxAgeSeconds: number
    nowMs: number
    lastAccepted?: AcceptedReflectorQuote
}

export interface PriceIngestionDecision {
    result: PriceIngestionResult
    reasonCode: PriceIngestionReasonCode
    reason: string
    asset: string
    source: PriceDataSource
    observedPrice: number
    observedLedger?: number
    acceptedPrice?: number
    acceptedLedger?: number
    acceptedSource?: PriceDataSource
    ageMs: number
    shouldPersist: boolean
}

function toMilliseconds(timestamp: number): number {
    return timestamp >= 1e12 ? Math.floor(timestamp) : Math.floor(timestamp * 1000)
}

function reject(
    input: ReflectorQuoteUpdateInput,
    reasonCode: PriceIngestionReasonCode,
    reason: string,
    ageMs: number
): PriceIngestionDecision {
    return {
        result: 'rejected',
        reasonCode,
        reason,
        asset: input.asset,
        source: input.source,
        observedPrice: input.price,
        observedLedger: input.ledger,
        acceptedPrice: input.lastAccepted?.price,
        acceptedLedger: input.lastAccepted?.ledger,
        acceptedSource: input.lastAccepted?.source,
        ageMs,
        shouldPersist: false,
    }
}

export function evaluateReflectorPriceUpdate(input: ReflectorQuoteUpdateInput): PriceIngestionDecision {
    const maxAgeMs = Math.max(0, Math.floor(input.maxAgeSeconds * 1000))
    const observedAtMs = toMilliseconds(input.timestamp)
    const ageMs = Math.max(0, Math.floor(input.nowMs) - observedAtMs)

    if (!Number.isFinite(input.price) || input.price <= 0
        || !Number.isFinite(input.timestamp) || input.timestamp <= 0
        || (input.ledger !== undefined && (!Number.isInteger(input.ledger) || input.ledger < 0))
        || !Number.isFinite(input.maxAgeSeconds) || input.maxAgeSeconds < 0
        || !Number.isFinite(input.nowMs)) {
        return reject(input, 'INVALID_QUOTE', 'Reflector quote has invalid price, timestamp, ledger or freshness configuration', ageMs)
    }

    if (input.ledger !== undefined && input.lastAccepted?.ledger !== undefined
        && input.ledger < input.lastAccepted.ledger) {
        return reject(
            input,
            'OLDER_LEDGER',
            `Reflector ledger ${input.ledger} is older than last accepted ledger ${input.lastAccepted.ledger}`,
            ageMs
        )
    }

    if (ageMs > maxAgeMs) {
        return reject(
            input,
            'STALE_QUOTE',
            `Reflector quote is ${Math.floor(ageMs / 1000)}s old (limit ${Math.floor(maxAgeMs / 1000)}s)`,
            ageMs
        )
    }

    const reasonCode = ageMs === maxAgeMs ? 'FRESH_AT_LIMIT' : 'FRESH'
    return {
        result: 'accepted',
        reasonCode,
        reason: reasonCode === 'FRESH_AT_LIMIT'
            ? 'Reflector quote accepted at the configured freshness limit'
            : 'Reflector quote accepted within the configured freshness limit',
        asset: input.asset,
        source: input.source,
        observedPrice: input.price,
        observedLedger: input.ledger,
        acceptedPrice: input.price,
        acceptedLedger: input.ledger ?? input.lastAccepted?.ledger,
        acceptedSource: input.source,
        ageMs,
        shouldPersist: true,
    }
}
