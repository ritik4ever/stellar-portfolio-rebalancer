import { describe, it, expect } from 'vitest'
import { REDACTED_HINT, sanitizeErrorDetails, sanitizeErrorMessage } from '../utils/errorSanitizer.js'

describe('sanitizeErrorMessage', () => {
    it('redacts credential assignments but keeps the wording', () => {
        const sanitized = sanitizeErrorMessage(
            "Failed to get asset 'XLM': connection refused password=hunter2secret api_key=cg-abcdefghijkl"
        )

        expect(sanitized).toContain("Failed to get asset 'XLM'")
        expect(sanitized).toContain('connection refused')
        expect(sanitized).toContain('password=[REDACTED]')
        expect(sanitized).toContain('api_key=[REDACTED]')
        expect(sanitized).not.toContain('hunter2secret')
        expect(sanitized).not.toContain('cg-abcdefghijkl')
    })

    it('redacts the password of a connection string', () => {
        const sanitized = sanitizeErrorMessage('could not connect to postgres://appuser:s3cr3t@db.internal:5432/ledger')

        expect(sanitized).not.toContain('s3cr3t')
        expect(sanitized).not.toContain('appuser')
        expect(sanitized).toContain('@db.internal:5432/ledger')
    })

    it('redacts an authorization header value', () => {
        const sanitized = sanitizeErrorMessage('request failed Authorization: Bearer abc123xyz')

        expect(sanitized).not.toContain('abc123xyz')
    })

    it('redacts a Stellar secret key', () => {
        const stellarSecret = `S${'A'.repeat(55)}`

        expect(sanitizeErrorMessage(`signing failed with ${stellarSecret}`)).not.toContain(stellarSecret)
    })

    it('removes stack frames', () => {
        const sanitized = sanitizeErrorMessage('Boom\n    at Object.<anonymous> (/srv/app/src/routes.ts:12:5)')

        expect(sanitized).toBe('Boom')
    })

    it('keeps a message without credentials untouched', () => {
        expect(sanitizeErrorMessage('ALLOW_FALLBACK_PRICES is disabled')).toBe('ALLOW_FALLBACK_PRICES is disabled')
    })

    it('returns an empty or non-string message unchanged', () => {
        expect(sanitizeErrorMessage('')).toBe('')
        expect(sanitizeErrorMessage(undefined as unknown as string)).toBeUndefined()
    })

    it('is idempotent', () => {
        const once = sanitizeErrorMessage('boom password=hunter2secret')

        expect(sanitizeErrorMessage(once)).toBe(once)
        expect(sanitizeErrorMessage(once)).toContain(`password=${REDACTED_HINT}`)
    })
})

describe('sanitizeErrorDetails', () => {
    it('reduces an Error to name and message', () => {
        const error = new Error('upstream failed password=hunter2secret')
        error.stack = 'Error: upstream failed\n    at Object.<anonymous> (/srv/app/src/x.ts:1:1)'

        const sanitized = sanitizeErrorDetails(error) as { name: string; message: string }

        expect(sanitized.name).toBe('Error')
        expect(sanitized.message).toContain(`password=${REDACTED_HINT}`)
        expect(sanitized.message).not.toContain('hunter2secret')
        expect((sanitized as Record<string, unknown>).stack).toBeUndefined()
    })

    it('sanitizes strings, arrays and nested objects', () => {
        const sanitized = sanitizeErrorDetails({
            reason: 'failed with password=hunter2secret',
            upstream: ['api_key=cg-abcdefghijkl', { secret: 'value' }],
        }) as Record<string, unknown>

        expect((sanitized.reason as string)).toContain(`password=${REDACTED_HINT}`)
        const upstream = sanitized.upstream as unknown[]
        expect((upstream[0] as string)).toContain(`api_key=${REDACTED_HINT}`)
        expect((upstream[1] as Record<string, unknown>).secret).toBe(REDACTED_HINT)
    })

    it('masks fields whose name denotes a secret', () => {
        const sanitized = sanitizeErrorDetails({
            apiKey: 'cg-abcdefghijkl',
            smtpPass: 'hunter2',
            field: 'amount',
        }) as Record<string, unknown>

        expect(sanitized.apiKey).toBe(REDACTED_HINT)
        expect(sanitized.smtpPass).toBe(REDACTED_HINT)
        expect(sanitized.field).toBe('amount')
    })

    it('drops a stack property', () => {
        const sanitized = sanitizeErrorDetails({ stack: 'Error: x\n    at y (a.ts:1:1)', keep: 'me' }) as Record<
            string,
            unknown
        >

        expect(sanitized.stack).toBeUndefined()
        expect(sanitized.keep).toBe('me')
    })

    it('returns primitives and nullish values unchanged', () => {
        expect(sanitizeErrorDetails(42)).toBe(42)
        expect(sanitizeErrorDetails(true)).toBe(true)
        expect(sanitizeErrorDetails(null)).toBeNull()
        expect(sanitizeErrorDetails(undefined)).toBeUndefined()
    })
})
