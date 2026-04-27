import type { CorsOptions } from 'cors'
import type { Request, Response, NextFunction } from 'express'

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'] as const
const ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'X-Request-Id',
] as const

export function buildCorsOptions(corsOrigins: string[]): CorsOptions {
    return {
        origin: corsOrigins.length > 0 ? corsOrigins : true,
        credentials: true,
        methods: [...ALLOWED_METHODS],
        allowedHeaders: [...ALLOWED_HEADERS],
    }
}

export function enforceCorsOriginAllowlist(corsOrigins: string[]) {
    const hasAllowlist = corsOrigins.length > 0
    const allowedOrigins = new Set(corsOrigins)

    return (req: Request, res: Response, next: NextFunction): void => {
        const origin = req.headers.origin
        if (!origin || !hasAllowlist || allowedOrigins.has(origin)) {
            next()
            return
        }

        res.status(403).json({
            success: false,
            data: null,
            error: {
                code: 'CORS_FORBIDDEN_ORIGIN',
                message: 'Origin is not allowed by CORS policy',
            },
            timestamp: new Date().toISOString(),
        })
    }
}
