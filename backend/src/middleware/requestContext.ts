import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger.js'
import { runWithRequestContext } from '../utils/requestContext.js'

const getHeaderValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const inboundId = getHeaderValue(req.headers['x-request-id'])
    const requestId = inboundId && inboundId.trim().length > 0 ? inboundId.trim() : randomUUID()

    req.requestId = requestId
    res.setHeader('X-Request-Id', requestId)

    const start = process.hrtime.bigint()

    runWithRequestContext({ requestId }, () => {
        logger.info('http_request_start', {
            requestId,
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('user-agent'),
        })

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
            logger.info('http_request_end', {
                requestId,
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                durationMs,
            })
        })

        next()
    })
}
