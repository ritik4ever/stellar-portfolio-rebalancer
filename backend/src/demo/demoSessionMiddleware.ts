/**
 * Express middleware that loads (or creates) a demo session from Redis.
 * Attaches session to req.demoSession.
 * Only active when DEMO_MODE=true.
 *
 * The client passes a session token in X-Demo-Session.
 * If the header is missing, a 400 is returned for demo-only endpoints.
 */
import type { Request, Response, NextFunction } from 'express'
import { getDemoSession, saveDemoSession, touchDemoSession } from './demoSessionStore.js'
import type { DemoSession } from './demoSessionStore.js'
import { fail } from '../utils/apiResponse.js'

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            demoSession?: DemoSession
            demoSessionToken?: string
        }
    }
}

export async function loadDemoSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = req.headers['x-demo-session'] as string | undefined
    if (!token || !token.trim()) {
        fail(res, 400, 'VALIDATION_ERROR', 'X-Demo-Session header is required in demo mode')
        return
    }

    const trimmed = token.trim()
    let session = await getDemoSession(trimmed)

    if (!session) {
        // Auto-create a new session on first access
        session = { createdAt: new Date().toISOString() }
        await saveDemoSession(trimmed, session)
    } else {
        // Refresh TTL on every access
        await touchDemoSession(trimmed)
    }

    req.demoSession = session
    req.demoSessionToken = trimmed
    next()
}

export async function saveDemoSessionFromReq(req: Request): Promise<void> {
    if (req.demoSessionToken && req.demoSession) {
        await saveDemoSession(req.demoSessionToken, req.demoSession)
    }
}
