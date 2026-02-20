import { Request, Response, NextFunction } from 'express'

export function blockDebugInProduction(req: Request, res: Response, next: NextFunction): void {
    if (process.env.NODE_ENV === 'production') {
        res.status(404).json({ success: false, error: 'Not Found' })
        return
    }
    next()
}
