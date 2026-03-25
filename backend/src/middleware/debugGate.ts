import { Request, Response, NextFunction } from 'express'
import { getFeatureFlags } from '../config/featureFlags.js'
import { fail } from '../utils/apiResponse.js'

export function blockDebugInProduction(req: Request, res: Response, next: NextFunction): void {
    const flags = getFeatureFlags()
    if (!flags.enableDebugRoutes) {
        fail(res, 404, 'NOT_FOUND', 'Not Found')
        return
    }
    next()
}
