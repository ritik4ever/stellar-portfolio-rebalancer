import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    getFrontendDebugConfig,
    logApiRequest,
    logApiResponse,
    sanitizeHeadersForLog,
    summarizePayloadForLog,
    summarizeResponseForLog,
} from './debug'

describe('debug utilities', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('enables API debug logs in development and disables them in production by default', () => {
        expect(getFrontendDebugConfig({ DEV: true, PROD: false }).enableApiDebugLogs).toBe(true)
        expect(getFrontendDebugConfig({ DEV: false, PROD: true, MODE: 'production' }).enableApiDebugLogs).toBe(false)
    })

    it('keeps production API logs disabled by default', () => {
        expect(getFrontendDebugConfig({ DEV: false, PROD: true, MODE: 'production' }).enableProductionApiLogs).toBe(false)
    })

    it('redacts sensitive request headers', () => {
        expect(sanitizeHeadersForLog({
            Authorization: 'Bearer token',
            Accept: 'application/json',
            'X-Trace-Id': 'abc123',
        })).toEqual({
            Authorization: '[REDACTED]',
            Accept: 'application/json',
            'X-Trace-Id': 'abc123',
        })
    })

    it('summarizes sensitive payloads without dumping secrets', () => {
        expect(summarizePayloadForLog({
            address: 'GABC',
            refreshToken: 'super-secret',
            nested: { foo: 'bar' },
            items: [1, 2, 3],
        })).toEqual({
            address: {
                type: 'string',
                length: 4,
            },
            refreshToken: '[REDACTED]',
            nested: {
                type: 'object',
                keys: ['foo'],
            },
            items: {
                type: 'array',
                length: 3,
            },
        })
    })

    it('reduces response logging to a safe summary', () => {
        expect(summarizeResponseForLog({
            success: false,
            data: { id: 'p1', amount: 12 },
            error: { code: 'INVALID' },
        })).toEqual({
            keys: ['success', 'data', 'error'],
            success: false,
            errorCode: 'INVALID',
        })
    })

    it('logs sanitized request details in development only', () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

        logApiRequest('API Request', {
            headers: { Authorization: 'Bearer token', Accept: 'application/json' },
            body: { refreshToken: 'secret', amount: 42 },
        }, { DEV: true, PROD: false, MODE: 'development' })

        expect(debugSpy).toHaveBeenCalledWith('API Request', {
            headers: {
                Authorization: '[REDACTED]',
                Accept: 'application/json',
            },
            body: {
                refreshToken: '[REDACTED]',
                amount: 42,
            },
        })
    })

    it('suppresses request and response console logs in production by default', () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        logApiRequest('API Request', {
            headers: { Authorization: 'Bearer token' },
            body: { refreshToken: 'secret' },
        }, { DEV: false, PROD: true, MODE: 'production' })

        logApiResponse('API Response', {
            status: 200,
            headers: { Authorization: 'Bearer token' },
            body: { success: true, data: { id: 'p1' } },
        }, { DEV: false, PROD: true, MODE: 'production' })

        expect(debugSpy).not.toHaveBeenCalled()
        expect(infoSpy).not.toHaveBeenCalled()
    })

    it('allows an explicit production-safe response summary when enabled', () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        logApiResponse('API Response', {
            status: 500,
            headers: { Authorization: 'Bearer token' },
            body: { success: false, error: { code: 'SERVER_ERROR', details: { secret: 'hidden' } } },
        }, { DEV: false, PROD: true, MODE: 'production', VITE_ENABLE_API_PROD_LOGS: 'true' })

        expect(infoSpy).toHaveBeenCalledWith('API Response', {
            status: 500,
            body: {
                keys: ['success', 'error'],
                success: false,
                errorCode: 'SERVER_ERROR',
            },
        })
    })
})
