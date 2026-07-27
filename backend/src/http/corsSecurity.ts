import type { CorsOptions } from 'cors'
import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'

const PROBE_PATHS = new Set(['/health', '/ready', '/readiness', '/metrics'])

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'] as const
const ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'X-Request-Id',
] as const

export function parseCorsOrigins(raw: string): string[] {
    return raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
}

export function buildCorsOptions(corsOrigins: string[], nodeEnv?: string): CorsOptions {
    const isProduction = nodeEnv === 'production'

    if (isProduction && corsOrigins.length === 0) {
        logger.warn('[CORS] No CORS_ORIGINS configured in production — all cross-origin requests will be rejected')
    }

    if (isProduction && corsOrigins.includes('*')) {
        logger.warn('[CORS] Wildcard "*" in CORS_ORIGINS is ignored in production')
        const filtered = corsOrigins.filter((o) => o !== '*')
        return {
            origin: filtered.length > 0 ? filtered : false,
            credentials: true,
            methods: [...ALLOWED_METHODS],
            allowedHeaders: [...ALLOWED_HEADERS],
            maxAge: 86400,
        }
    }

    return {
        origin: corsOrigins.length > 0 ? corsOrigins : true,
        credentials: true,
        methods: [...ALLOWED_METHODS],
        allowedHeaders: [...ALLOWED_HEADERS],
        maxAge: 86400,
    }
}

export function enforceCorsOriginAllowlist(corsOrigins: string[]) {
    const hasAllowlist = corsOrigins.length > 0 && !corsOrigins.includes('*')
    const allowedOrigins = new Set(corsOrigins)

    return (req: Request, res: Response, next: NextFunction): void => {
        if (PROBE_PATHS.has(req.path)) {
            next()
            return
        }

        const origin = req.headers.origin
        if (!origin || !hasAllowlist || allowedOrigins.has(origin)) {
            next()
            return
        }

        logger.warn('[CORS] Rejected origin', { origin, path: req.path, method: req.method })

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
