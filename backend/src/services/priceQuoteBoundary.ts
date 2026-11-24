import type { PriceDataSource, PricesFeedPayload } from '../types/index.js'

export type PriceQuoteResult = 'accepted' | 'partial' | 'rejected'

export type PriceQuoteReasonCode =
    | 'FULL_REFLECTOR_COVERAGE'
    | 'MISSING_REFLECTOR_QUOTE_FALLBACK'
    | 'MISSING_REFLECTOR_QUOTE_REJECTED'
    | 'MULTIPLE_NON_REFLECTOR_QUOTES'
    | 'NO_PRICES'

export type PriceQuoteRejectionReason = 'MISSING_REFLECTOR_QUOTE' | 'NO_PRICES'

export interface PriceProvenance {
    source: PriceDataSource | 'unknown'
    dataTier?: string
    price: number
    servedFromCache: boolean
}

export interface QuoteRejection {
    asset: string
    reason: PriceQuoteRejectionReason
    acceptedSource?: PriceDataSource | 'unknown'
}

export interface PriceQuoteBoundaryDecision {
    result: PriceQuoteResult
    reasonCode: PriceQuoteReasonCode
    reason: string
    provenance: Record<string, PriceProvenance>
    rejection?: QuoteRejection
    quoteSnapshot: PricesFeedPayload
}

function isFallbackSource(source: PriceDataSource | undefined): boolean {
    return source?.startsWith('coingecko_') === true || source === 'external'
}

export function evaluatePriceQuoteBoundary(payload: PricesFeedPayload): PriceQuoteBoundaryDecision {
    const entries = Object.entries(payload.prices ?? {}).sort(([a], [b]) => a.localeCompare(b))
    const provenance: Record<string, PriceProvenance> = {}
    for (const [asset, price] of entries) {
        provenance[asset] = {
            source: price.source ?? 'unknown',
            dataTier: price.dataTier,
            price: price.price,
            servedFromCache: price.servedFromCache === true,
        }
    }

    const quoteSnapshot: PricesFeedPayload = { prices: payload.prices, feedMeta: payload.feedMeta }
    const nonReflector = entries.filter(([, price]) => price.source !== 'reflector')
    const rejected = nonReflector.filter(([, price]) => !isFallbackSource(price.source))

    if (entries.length === 0) {
        return {
            result: 'rejected',
            reasonCode: 'NO_PRICES',
            reason: 'No price quote was available from any source',
            provenance,
            rejection: { asset: '', reason: 'NO_PRICES' },
            quoteSnapshot,
        }
    }

    if (nonReflector.length === 0) {
        return {
            result: 'accepted',
            reasonCode: 'FULL_REFLECTOR_COVERAGE',
            reason: 'Every served quote came from Reflector',
            provenance,
            quoteSnapshot,
        }
    }

    if (rejected.length > 0) {
        const [asset] = rejected[0]
        return {
            result: 'rejected',
            reasonCode: nonReflector.length === 1 ? 'MISSING_REFLECTOR_QUOTE_REJECTED' : 'MULTIPLE_NON_REFLECTOR_QUOTES',
            reason: `Reflector quote is missing for ${asset} and no accepted fallback source served that asset`,
            provenance,
            rejection: { asset, reason: 'MISSING_REFLECTOR_QUOTE', acceptedSource: undefined },
            quoteSnapshot,
        }
    }

    const [asset, price] = nonReflector[0]
    return {
        result: 'partial',
        reasonCode: nonReflector.length === 1
            ? 'MISSING_REFLECTOR_QUOTE_FALLBACK'
            : 'MULTIPLE_NON_REFLECTOR_QUOTES',
        reason: nonReflector.length === 1
            ? `Reflector quote is missing for ${asset}; the fallback quote is documented in provenance`
            : 'Multiple assets were served without a Reflector quote',
        provenance,
        rejection: nonReflector.length === 1
            ? { asset, reason: 'MISSING_REFLECTOR_QUOTE', acceptedSource: price.source }
            : undefined,
        quoteSnapshot,
    }
}
