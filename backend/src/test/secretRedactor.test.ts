import { describe, expect, it } from 'vitest'
import { redactObject, redactString } from '../utils/secretRedactor.js'

describe('secretRedactor', () => {
    it('redacts authorization header values', () => {
        const input = {
            headers: {
                authorization: 'Bearer very-sensitive-token',
                'content-type': 'application/json',
            },
        }

        const output = redactObject(input)

        expect(output.headers.authorization).toBe('[REDACTED]')
        expect(output.headers['content-type']).toBe('application/json')
    })

    it('redacts privateKey, secret, and apiKey fields', () => {
        const input = {
            privateKey: 'super-private-key',
            secret: 'my-secret',
            apiKey: 'api-key-value',
            normalField: 'safe',
        }

        const output = redactObject(input)

        expect(output.privateKey).toBe('[REDACTED]')
        expect(output.secret).toBe('[REDACTED]')
        expect(output.apiKey).toBe('[REDACTED]')
        expect(output.normalField).toBe('safe')
    })

    it('keeps non-sensitive fields unchanged', () => {
        const input = {
            level: 'info',
            route: '/api/v1/portfolio',
            statusCode: 200,
            message: 'request complete',
        }

        const output = redactObject(input)

        expect(output).toEqual(input)
    })

    it('redacts nested secret fields deeply', () => {
        const input = {
            request: {
                meta: {
                    retries: 2,
                    credentials: {
                        jwtSecret: 'jwt-secret-value',
                        wallet: {
                            privateKey: 'wallet-private-key',
                        },
                    },
                },
            },
            arrayValues: [
                { api_key: 'coingecko-key' },
                { asset: 'XLM' },
            ],
        }

        const output = redactObject(input)

        expect(output.request.meta.credentials.jwtSecret).toBe('[REDACTED]')
        expect(output.request.meta.credentials.wallet.privateKey).toBe('[REDACTED]')
        expect(output.arrayValues[0].api_key).toBe('[REDACTED]')
        expect(output.arrayValues[1].asset).toBe('XLM')
        expect(output.request.meta.retries).toBe(2)
    })

    it('redacts webhookUrl and webhook fields', () => {
        const input = {
            sentTo: {
                webhookUrl: 'https://hooks.example.com/secret-token',
                webhook: 'https://hooks.example.com/other-token',
            },
        }
        const output = redactObject(input)
        expect((output.sentTo as any).webhookUrl).toBe('[REDACTED]')
        expect((output.sentTo as any).webhook).toBe('[REDACTED]')
    })

    it('redacts email address fields', () => {
        const input = { emailAddress: 'user@example.com', smtpUser: 'smtp@example.com', smtpPass: 'hunter2' }
        const output = redactObject(input)
        expect((output as any).emailAddress).toBe('[REDACTED]')
        expect((output as any).smtpUser).toBe('[REDACTED]')
        expect((output as any).smtpPass).toBe('[REDACTED]')
    })

    it('redacts Bearer tokens in strings', () => {
        expect(redactString('Authorization: Bearer abc123xyz')).toBe('Authorization: Bearer [REDACTED]')
        expect(redactString('no token here')).toBe('no token here')
    })

    it('redacts Stellar secret keys in strings', () => {
        // Valid Stellar secret key: S + 55 chars from base32 alphabet [A-Z2-7]
        const stellarSecret = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'
        expect(redactString(stellarSecret)).toBe('[REDACTED]')
    })

    it('redacts API keys in query params', () => {
        const url = 'https://api.example.com/data?api_key=supersecret&foo=bar'
        expect(redactString(url)).toBe('https://api.example.com/data?api_key=[REDACTED]&foo=bar')
    })
})
