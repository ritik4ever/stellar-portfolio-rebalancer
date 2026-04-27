import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getAuthConfig } from '../services/authService.js'
import { fail } from '../utils/apiResponse.js'

export interface JwtUser {
    address: string
}

interface AccessJwtPayload extends jwt.JwtPayload {
    sub: string
    type: 'access'
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

    const verification = verifyAccessTokenWithRotation(token)
    if (!verification.ok) {
        const isExpired = verification.reason === 'expired'
        fail(
            res,
            401,
            isExpired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
            isExpired ? 'Access token expired' : 'Invalid access token'
        )
        return
    }

    req.user = { address: verification.payload.sub }
    next()
}

export function requireJwtWhenEnabled(req: Request, res: Response, next: NextFunction): void {
    if (!getAuthConfig().enabled) return next()
    requireJwt(req, res, next)
}

function verifyAccessTokenWithRotation(token: string):
    | { ok: true; payload: AccessJwtPayload }
    | { ok: false; reason: 'expired' | 'invalid' } {
    const currentSecret = process.env.JWT_SECRET
    if (!currentSecret || currentSecret.length < 32) {
        return { ok: false, reason: 'invalid' }
    }

    const currentResult = verifyWithSecret(token, currentSecret)
    if (currentResult.ok) return currentResult
    if (currentResult.reason === 'expired') return currentResult

    const previousSecret = process.env.JWT_PREVIOUS_SECRET
    if (!isPreviousSecretWithinGracePeriod(previousSecret)) {
        return currentResult
    }

    return verifyWithSecret(token, previousSecret as string)
}

function verifyWithSecret(token: string, secret: string):
    | { ok: true; payload: AccessJwtPayload }
    | { ok: false; reason: 'expired' | 'invalid' } {
    try {
        const decoded = jwt.verify(token, secret)
        if (!isAccessPayload(decoded)) {
            return { ok: false, reason: 'invalid' }
        }
        return { ok: true, payload: decoded }
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return { ok: false, reason: 'expired' }
        }
        return { ok: false, reason: 'invalid' }
    }
}

function isAccessPayload(payload: string | jwt.JwtPayload): payload is AccessJwtPayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        typeof payload.sub === 'string' &&
        payload.type === 'access'
    )
}

function isPreviousSecretWithinGracePeriod(previousSecret: string | undefined): boolean {
    if (!previousSecret || previousSecret.length < 32) return false
    const graceUntilRaw = process.env.JWT_PREVIOUS_SECRET_GRACE_UNTIL
    if (!graceUntilRaw) return false
    const graceUntilMs = Date.parse(graceUntilRaw)
    if (Number.isNaN(graceUntilMs)) return false
    return Date.now() <= graceUntilMs
}
