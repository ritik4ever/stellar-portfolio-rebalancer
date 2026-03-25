import type { Response } from 'express'

export interface ApiErrorBody {
    code: string
    message: string
    details?: unknown
}

export interface ApiResponseEnvelope<T> {
    success: boolean
    data: T | null
    error: ApiErrorBody | null
    timestamp: string
    meta?: Record<string, unknown>
}

interface ResponseOptions {
    status?: number
    meta?: Record<string, unknown>
}

const nowIso = (): string => new Date().toISOString()

export function ok<T>(
    res: Response,
    data: T,
    options: ResponseOptions = {}
): Response<ApiResponseEnvelope<T>> {
    const payload: ApiResponseEnvelope<T> = {
        success: true,
        data,
        error: null,
        timestamp: nowIso(),
        ...(options.meta ? { meta: options.meta } : {})
    }

    return res.status(options.status ?? 200).json(payload)
}

export function fail(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown,
    options: ResponseOptions = {}
): Response<ApiResponseEnvelope<null>> {
    const payload: ApiResponseEnvelope<null> = {
        success: false,
        data: null,
        error: {
            code,
            message,
            ...(details === undefined ? {} : { details })
        },
        timestamp: nowIso(),
        ...(options.meta ? { meta: options.meta } : {})
    }

    return res.status(status).json(payload)
}
