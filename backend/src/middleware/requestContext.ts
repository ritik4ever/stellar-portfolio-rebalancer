import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger.js'
import { runWithRequestContext } from '../utils/requestContext.js'

const getHeaderValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const inboundId = getHeaderValue(req.headers['x-request-id'])
    const inboundCorrelationId = getHeaderValue(req.headers['x-correlation-id'])
    const requestId = inboundId && inboundId.trim().length > 0 ? inboundId.trim() : randomUUID()
    const correlationId = inboundCorrelationId && inboundCorrelationId.trim().length > 0
        ? inboundCorrelationId.trim()
        : requestId

    req.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    res.setHeader('X-Correlation-Id', correlationId)

    const start = process.hrtime.bigint()

    runWithRequestContext({ requestId, correlationId }, () => {
        logger.info('http_request_start', {
            requestId,
            correlation_id: correlationId,
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('user-agent'),
        })

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
            logger.info('http_request_end', {
                requestId,
                correlation_id: correlationId,
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                durationMs,
            })
        })

        next()
    })
}
