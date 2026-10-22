import { describe, expect, it } from 'vitest'
import { sanitizeError, sanitizeObservabilityText } from './observability'

describe('observability data sanitization', () => {
    it('redacts bearer tokens, key-value secrets, and Stellar secret keys', () => {
        const stellarSecret = `S${'A'.repeat(55)}`
        const value = sanitizeObservabilityText(
            `Bearer abc.def.ghi apiKey=coingecko-secret private_key: ${stellarSecret} publicKey=GABC123`,
        )

        expect(value).not.toContain('abc.def.ghi')
        expect(value).not.toContain('coingecko-secret')
        expect(value).not.toContain(stellarSecret)
        expect(value).toContain('publicKey=GABC123')
        expect(value).toContain('[REDACTED]')
    })

    it('returns a sanitized Error without changing the original error', () => {
        const original = new Error('request failed with token=super-secret')
        const sanitized = sanitizeError(original)

        expect(sanitized).not.toBe(original)
        expect(sanitized.message).toBe('request failed with token=[REDACTED]')
        expect(original.message).toContain('super-secret')
    })
})
