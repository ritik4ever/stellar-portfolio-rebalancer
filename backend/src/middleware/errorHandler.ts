import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import { fail } from '../utils/apiResponse.js'
import { ApiError } from '../utils/apiErrors.js'

export interface AppError extends Error {
    statusCode?: number
    status?: string
    isOperational?: boolean
}

const getErrorCode = (statusCode: number): string => {
    switch (statusCode) {
        case 400:
            return 'VALIDATION_ERROR'
        case 401:
            return 'UNAUTHORIZED'
        case 403:
            return 'FORBIDDEN'
        case 404:
            return 'NOT_FOUND'
        case 409:
            return 'CONFLICT'
        case 429:
            return 'RATE_LIMITED'
        case 503:
            return 'SERVICE_UNAVAILABLE'
        default:
            return 'INTERNAL_ERROR'
    }
}

export const errorHandler = (
    err: AppError,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    err.statusCode = err.statusCode || 500
    err.status = err.status || 'error'

    logger.error(err.message, {
        stack: err.stack,
        url: req.url,
        method: req.method,
        statusCode: err.statusCode,
        requestId: req.requestId
    })

    if (err instanceof ApiError) {
    return fail(
        res,
        err.status,
        err.code,
        err.message,
        process.env.NODE_ENV === 'development'
            ? {
                  ...(typeof err.details === 'object' && err.details !== null ? err.details : {}),
                  stack: err.stack
              }
            : err.details
    )
}

    if (process.env.NODE_ENV === 'development') {
        return fail(
            res,
            err.statusCode,
            getErrorCode(err.statusCode),
            err.message,
            { stack: err.stack }
        )
    } else {
        // Production error response
        if (err.isOperational) {
            return fail(
                res,
                err.statusCode,
                getErrorCode(err.statusCode),
                err.message
            )
        } else {
            return fail(
                res,
                500,
                'INTERNAL_ERROR',
                'Something went wrong!'
            )
        }
    }
}

export const notFound = (req: Request, res: Response, _next: NextFunction) => {
    const error = new Error(`Not found - ${req.originalUrl}`) as AppError
    error.statusCode = 404
    error.isOperational = true
    _next(error)
}