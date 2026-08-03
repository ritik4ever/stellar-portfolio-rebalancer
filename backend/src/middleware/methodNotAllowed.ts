import type { Request, Response, NextFunction } from 'express'

/**
 * Middleware that returns 405 Method Not Allowed for HTTP methods
 * that are not supported (e.g., TRACE).
 *
 * Express returns 404 for unknown methods on a path. Schemathesis
 * expects 405 per HTTP spec. This middleware runs early in the stack
 * to catch dangerous/unsupported methods before route matching.
 */
export function blockUnsupportedMethods(req: Request, res: Response, next: NextFunction): void {
    const unsupported = ['TRACE', 'TRACK']
    if (unsupported.includes(req.method.toUpperCase())) {
        res.status(405).set('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS').json({
            success: false,
            error: {
                code: 'METHOD_NOT_ALLOWED',
                message: 'Method not allowed',
            },
        })
        return
    }
    next()
}
