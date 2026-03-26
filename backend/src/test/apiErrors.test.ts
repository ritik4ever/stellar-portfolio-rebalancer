import { describe, it, expect } from 'vitest'
import {
    ApiError,
    badRequest,
    validationError,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    rateLimited,
    serviceUnavailable,
    internalError,
    mapUnknownError
} from '../utils/apiErrors.js'

describe('apiErrors', () => {
    it('helper constructors build stable status/code/message', () => {
        expect(badRequest('bad').status).toBe(400)
        expect(validationError('invalid').code).toBe('VALIDATION_ERROR')
        expect(unauthorized('nope').status).toBe(401)
        expect(forbidden('nope').status).toBe(403)
        expect(notFound('missing').status).toBe(404)
        expect(conflict('conflict').status).toBe(409)
        expect(rateLimited('slow down').status).toBe(429)
        expect(serviceUnavailable('down').status).toBe(503)
        expect(internalError('boom').status).toBe(500)
    })

    it('mapUnknownError returns ApiError as-is', () => {
        const err = new ApiError(400, 'BAD_REQUEST', 'Bad payload', { field: 'x' })
        const mapped = mapUnknownError(err)
        expect(mapped).toBe(err)
    })

    it('mapUnknownError maps regular errors to INTERNAL_ERROR', () => {
        const mapped = mapUnknownError(new Error('unexpected'))
        expect(mapped.status).toBe(500)
        expect(mapped.code).toBe('INTERNAL_ERROR')
        expect(mapped.message).toBe('unexpected')
    })

    it('mapUnknownError maps non-errors safely', () => {
        const mapped = mapUnknownError({ foo: 'bar' })
        expect(mapped.status).toBe(500)
        expect(mapped.code).toBe('INTERNAL_ERROR')
    })
})
