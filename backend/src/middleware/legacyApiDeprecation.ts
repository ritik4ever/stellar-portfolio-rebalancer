import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'

const LEGACY_API_SUNSET = 'Wed, 01 Jul 2026 00:00:00 GMT'
const LEGACY_API_SUNSET_DATE = new Date('2026-07-01T00:00:00Z')
const LEGACY_API_MIGRATION_DOC = '</docs/api-migration-v1.md>; rel="deprecation"'
const LEGACY_API_MIGRATION_URL = '/docs/api-migration-v1.md'

const LEGACY_REDIRECTS: Record<string, string> = {
    '/portfolios': '/api/v1/portfolios'
}

/**
 * Deprecation metadata for API clients.
 * Follows RFC 8594 and includes comprehensive migration guidance.
 */
interface DeprecationMetadata {
    deprecated: true
    sunset: string
    sunsetDate: string
    sunsetSeconds: number
    migrationGuide: string
    suggestedAlternative: string
    lastSunsetWarning: boolean
}

/**
 * Calculate deprecation metadata for a given request path.
 */
function getDeprecationMetadata(path: string): DeprecationMetadata {
    const now = new Date()
    const sunsetMs = LEGACY_API_SUNSET_DATE.getTime() - now.getTime()
    const sunsetSeconds = Math.max(0, Math.floor(sunsetMs / 1000))
    
    // Determine if this is the last 7 days before sunset
    const daysUntilSunset = Math.ceil(sunsetSeconds / (24 * 60 * 60))
    const lastSunsetWarning = daysUntilSunset <= 7
    
    // Suggest the v1 alternative
    const suggestedAlternative = `/api/v1${path}`

    return {
        deprecated: true,
        sunset: LEGACY_API_SUNSET,
        sunsetDate: LEGACY_API_SUNSET_DATE.toISOString(),
        sunsetSeconds,
        migrationGuide: LEGACY_API_MIGRATION_URL,
        suggestedAlternative,
        lastSunsetWarning
    }
}

/**
 * Record deprecation usage for analytics and monitoring.
 */
function recordDeprecationUsage(req: Request, metadata: DeprecationMetadata): void {
    const daysUntilSunset = Math.ceil(metadata.sunsetSeconds / (24 * 60 * 60))
    const logLevel = metadata.lastSunsetWarning ? 'warn' : 'info'
    
    logger[logLevel]('[DEPRECATION]', {
        path: req.path,
        method: req.method,
        userAgent: req.get('user-agent'),
        sunsetDate: metadata.sunsetDate,
        daysUntilSunset,
        suggestedAlternative: metadata.suggestedAlternative,
        migrationGuide: metadata.migrationGuide,
        isLastWeekWarning: metadata.lastSunsetWarning
    })
}

/**
 * Middleware to attach deprecation headers and metadata to legacy API routes.
 * Returns RFC 8594 compliant Deprecation, Sunset, and Link headers.
 * Also includes custom X-API-Warn header with migration guidance.
 */
export const legacyApiDeprecation = (req: Request, res: Response, next: NextFunction) => {
    // Get deprecation metadata for this path
    const metadata = getDeprecationMetadata(req.path)
    
    // RFC 8594: Deprecation header
    res.setHeader('Deprecation', 'true')
    
    // RFC 8594: Sunset header - date after which resource is no longer available
    res.setHeader('Sunset', LEGACY_API_SUNSET)
    
    // RFC 8594: Link header with rel="deprecation" pointing to migration docs
    res.setHeader('Link', LEGACY_API_MIGRATION_DOC)
    
    // Custom header: X-API-Warn with concise migration info
    res.setHeader('X-API-Warn', `deprecated; sunset="${LEGACY_API_SUNSET}"; docs="${LEGACY_API_MIGRATION_URL}"`)
    
    // Custom header: X-API-Suggest with suggested v1 alternative
    res.setHeader('X-API-Suggest', `Use ${metadata.suggestedAlternative} instead`)
    
    // Record usage for monitoring (before redirect so we capture the request)
    recordDeprecationUsage(req, metadata)

    // Handle explicit redirects (e.g., /api/portfolios -> /api/v1/portfolios)
    const target = LEGACY_REDIRECTS[req.path]
    if (target) {
        const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
        const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308
        
        logger.debug('[DEPRECATION-REDIRECT]', {
            from: req.path,
            to: target,
            method: req.method,
            httpStatus: status
        })
        
        res.redirect(status, `${target}${search}`)
        return
    }

    // Intercept JSON responses to optionally include deprecation metadata
    const originalJson = res.json.bind(res)
    res.json = function(body: any) {
        // Add deprecation metadata to error responses or specific response types
        if (body && typeof body === 'object' && (body.error || body.deprecation === undefined)) {
            // Only add to response body if it's an error-like object or explicitly requested
            // Avoid polluting all responses to maintain backward compatibility
            if (body.error || (req.query._includeDeprecation === 'true')) {
                body.deprecation = {
                    ...metadata,
                    message: `This endpoint is deprecated. Please use ${metadata.suggestedAlternative} instead. See ${metadata.migrationGuide}`
                }
            }
        }
        return originalJson(body)
    }

    next()
}
