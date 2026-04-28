import { Request, Response, NextFunction } from 'express'

const LEGACY_API_SUNSET = 'Wed, 01 Jul 2026 00:00:00 GMT'
const LEGACY_API_MIGRATION_DOC = '</docs/api-migration-v1.md>; rel="deprecation"'
const LEGACY_REDIRECTS: Record<string, string> = {
    '/portfolios': '/api/v1/portfolios'
}

export const legacyApiDeprecation = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Deprecation', 'true')
    res.setHeader('Sunset', LEGACY_API_SUNSET)
    res.setHeader('Link', LEGACY_API_MIGRATION_DOC)

    const target = LEGACY_REDIRECTS[req.path]
    if (target) {
        const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
        const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308
        res.redirect(status, `${target}${search}`)
        return
    }
    next()
}
