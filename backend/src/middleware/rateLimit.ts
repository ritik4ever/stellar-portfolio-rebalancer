import { rateLimit, type Options } from 'express-rate-limit'
import { fail } from '../utils/apiResponse.js'

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000
const max = Number(process.env.RATE_LIMIT_MAX) || 100
const writeMax = Number(process.env.RATE_LIMIT_WRITE_MAX) || 10

function createHandler(ms: number) {
    const retryAfterSec = Math.ceil(ms / 1000)
    return (req: import('express').Request, res: import('express').Response) => {
        res.setHeader('Retry-After', String(retryAfterSec))
        fail(
            res,
            429,
            'RATE_LIMITED',
            'Rate limit exceeded. Please try again later.',
            undefined,
            { meta: { retryAfter: retryAfterSec } }
        )
    }
}

const baseOptions: Partial<Options> = {
    windowMs,
    standardHeaders: true,
    legacyHeaders: false
}

export const globalRateLimiter = rateLimit({
    ...baseOptions,
    max,
    handler: createHandler(windowMs)
})

export const writeRateLimiter = rateLimit({
    ...baseOptions,
    max: writeMax,
    handler: createHandler(windowMs)
})
