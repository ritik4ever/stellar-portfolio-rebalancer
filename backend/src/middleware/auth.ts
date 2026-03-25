import { Request, Response, NextFunction } from 'express'
import { Keypair } from '@stellar/stellar-sdk'
import { fail } from '../utils/apiResponse.js'

const ADMIN_KEYS = (process.env.ADMIN_PUBLIC_KEYS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (ADMIN_KEYS.length === 0) {
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
    if (!ADMIN_KEYS.includes(pub)) {
        fail(res, 403, 'FORBIDDEN', 'Forbidden')
        return
    }
    next()
}
