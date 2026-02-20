import { Request, Response, NextFunction } from 'express'
import { getFeatureFlags } from '../config/featureFlags.js'

export function blockDebugInProduction(req: Request, res: Response, next: NextFunction): void {
    const flags = getFeatureFlags()
    if (!flags.enableDebugRoutes) {
        res.status(404).json({ success: false, error: 'Not Found' })
        return
    }
    next()
}
