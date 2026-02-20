import { Request, Response, NextFunction } from 'express'
import { Keypair } from '@stellar/stellar-sdk'

const ADMIN_KEYS = (process.env.ADMIN_PUBLIC_KEYS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (ADMIN_KEYS.length === 0) {
        res.status(503).json({ success: false, error: 'Admin auth not configured' })
        return
    }
    const pub = req.headers['x-public-key'] as string | undefined
    const msg = req.headers['x-message'] as string | undefined
    const sig = req.headers['x-signature'] as string | undefined
    if (!pub || !msg || !sig) {
        res.status(401).json({ success: false, error: 'Missing X-Public-Key, X-Message, or X-Signature' })
        return
    }
    const ts = parseInt(msg, 10)
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
        res.status(401).json({ success: false, error: 'Invalid or expired message timestamp' })
        return
    }
    try {
        const kp = Keypair.fromPublicKey(pub)
        const msgBuf = Buffer.from(msg, 'utf8')
        const sigBuf = Buffer.from(sig, 'base64')
        if (!kp.verify(msgBuf, sigBuf)) {
            res.status(403).json({ success: false, error: 'Invalid signature' })
            return
        }
    } catch {
        res.status(403).json({ success: false, error: 'Invalid public key or signature' })
        return
    }
    if (!ADMIN_KEYS.includes(pub)) {
        res.status(403).json({ success: false, error: 'Forbidden' })
        return
    }
    next()
}
