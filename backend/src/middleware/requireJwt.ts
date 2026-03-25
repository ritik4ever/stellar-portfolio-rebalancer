import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../services/authService.js'
import { getAuthConfig } from '../services/authService.js'
import { fail } from '../utils/apiResponse.js'

export interface JwtUser {
    address: string
}

declare global {
    namespace Express {
        interface Request {
            user?: JwtUser
        }
    }
}

export function requireJwt(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    if (!token) {
        fail(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header')
        return
    }
    const payload = verifyAccessToken(token)
    if (!payload) {
        fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired token')
        return
    }
    req.user = { address: payload.sub }
    next()
}

export function requireJwtWhenEnabled(req: Request, res: Response, next: NextFunction): void {
    if (!getAuthConfig().enabled) return next()
    requireJwt(req, res, next)
}
