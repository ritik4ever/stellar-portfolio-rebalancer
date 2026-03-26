import { Request, Response, NextFunction } from 'express'

const LEGACY_API_SUNSET = 'Wed, 01 Jul 2026 00:00:00 GMT'
const LEGACY_API_MIGRATION_DOC = '</docs/api-migration-v1.md>; rel="deprecation"'

export const legacyApiDeprecation = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Deprecation', 'true')
    res.setHeader('Sunset', LEGACY_API_SUNSET)
    res.setHeader('Link', LEGACY_API_MIGRATION_DOC)
    next()
}
