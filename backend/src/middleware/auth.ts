import { Request, Response, NextFunction } from 'express'
import { Keypair } from '@stellar/stellar-sdk'
import { fail } from '../utils/apiResponse.js'
import { requireJwtWhenEnabled } from './requireJwt.js'

export function getAdminKeys(): string[] {
    return (process.env.ADMIN_PUBLIC_KEYS || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
}

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000

export function isRequestAdmin(req: Request): boolean {
    const adminKeys = getAdminKeys()
    if (adminKeys.length === 0) return false

    if (req.adminPublicKey && adminKeys.includes(req.adminPublicKey)) {
        return true
    }

    if (req.user?.address && adminKeys.includes(req.user.address)) {
        req.adminPublicKey = req.user.address
        return true
    }

    const pub = req.headers['x-public-key'] as string | undefined
    const msg = req.headers['x-message'] as string | undefined
    const sig = req.headers['x-signature'] as string | undefined
    if (!pub || !msg || !sig) return false

    const ts = parseInt(msg, 10)
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
        return false
    }

    try {
        const kp = Keypair.fromPublicKey(pub)
        const msgBuf = Buffer.from(msg, 'utf8')
        const sigBuf = Buffer.from(sig, 'base64')
        if (!kp.verify(msgBuf, sigBuf)) return false
    } catch {
        return false
    }

    if (!adminKeys.includes(pub)) return false

    req.adminPublicKey = pub
    return true
}

export function authenticateUserOrAdmin(req: Request, res: Response, next: NextFunction): void {
    if (isRequestAdmin(req)) {
        return next()
    }
    requireJwtWhenEnabled(req, res, next)
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    const adminKeys = getAdminKeys()
    if (adminKeys.length === 0) {
        fail(res, 503, 'SERVICE_UNAVAILABLE', 'Admin auth not configured')
        return
    }
    const pub = req.headers['x-public-key'] as string | undefined
    const msg = req.headers['x-message'] as string | undefined
    const sig = req.headers['x-signature'] as string | undefined
    if (!pub || !msg || !sig) {
        fail(res, 401, 'UNAUTHORIZED', 'Missing X-Public-Key, X-Message, or X-Signature')
        return
    }
    const ts = parseInt(msg, 10)
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
        fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired message timestamp')
        return
    }
    try {
        const kp = Keypair.fromPublicKey(pub)
        const msgBuf = Buffer.from(msg, 'utf8')
        const sigBuf = Buffer.from(sig, 'base64')
        if (!kp.verify(msgBuf, sigBuf)) {
            fail(res, 403, 'FORBIDDEN', 'Invalid signature')
            return
        }
    } catch {
        fail(res, 403, 'FORBIDDEN', 'Invalid public key or signature')
        return
    }
    if (!adminKeys.includes(pub)) {
        fail(res, 403, 'FORBIDDEN', 'Forbidden')
        return
    }
    req.adminPublicKey = pub
    next()
}

