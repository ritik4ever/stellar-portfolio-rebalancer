import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import { mapUnknownError } from '../utils/apiErrors.js'
import { fail } from '../utils/apiResponse.js'

export function apiErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(err)
        return
    }

    const mapped = mapUnknownError(err)
    logger.error('Unhandled API error', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        status: mapped.status,
        code: mapped.code,
        details: mapped.details
    })

    fail(res, mapped.status, mapped.code, mapped.message, mapped.details)
}
