export class ApiError extends Error {
    status: number
    code: string
    details?: unknown

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.details = details
    }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
    new ApiError(400, 'BAD_REQUEST', message, details)

export const validationError = (message: string, details?: unknown): ApiError =>
    new ApiError(400, 'VALIDATION_ERROR', message, details)

export const unauthorized = (message: string, details?: unknown): ApiError =>
    new ApiError(401, 'UNAUTHORIZED', message, details)

export const forbidden = (message: string, details?: unknown): ApiError =>
    new ApiError(403, 'FORBIDDEN', message, details)

export const notFound = (message: string, details?: unknown): ApiError =>
    new ApiError(404, 'NOT_FOUND', message, details)

export const conflict = (message: string, details?: unknown): ApiError =>
    new ApiError(409, 'CONFLICT', message, details)

export const rateLimited = (message: string, details?: unknown): ApiError =>
    new ApiError(429, 'RATE_LIMITED', message, details)

export const serviceUnavailable = (message: string, details?: unknown): ApiError =>
    new ApiError(503, 'SERVICE_UNAVAILABLE', message, details)

export const internalError = (message: string, details?: unknown): ApiError =>
    new ApiError(500, 'INTERNAL_ERROR', message, details)

export const mapUnknownError = (error: unknown): ApiError => {
    if (error instanceof ApiError) return error

    if (error instanceof Error) {
        return internalError(error.message || 'Internal server error')
    }

    return internalError('Internal server error')
}
