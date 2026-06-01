import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

export const requireJwt = (req: Request, res: Response, next: NextFunction): void => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    logger.warn({ event: 'jwt_missing', path: req.path }, 'Missing or malformed Authorization header');
    res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
    return;
  }

  const token = auth.split(' ')[1];
  const secret = process.env.JWT_SECRET || '';
  const previousSecret = process.env.JWT_PREVIOUS_SECRET || '';
  const gracUntil = process.env.JWT_PREVIOUS_SECRET_GRACE_UNTIL || '';

  // Try current secret first
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    (req as any).user = { address: payload.sub };
    return next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      logger.warn({ event: 'jwt_expired', path: req.path }, 'Token expired');
      res.status(401).json({ error: { code: 'TOKEN_EXPIRED' } });
      return;
    }
    // Fall through to try previous secret
  }

  // Try previous secret within grace period
  if (previousSecret && gracUntil) {
    const graceDate = new Date(gracUntil);
    if (new Date() <= graceDate) {
      try {
        const payload = jwt.verify(token, previousSecret) as jwt.JwtPayload;
        (req as any).user = { address: payload.sub };
        logger.info({ event: 'jwt_previous_secret_used', path: req.path }, 'Token accepted via previous secret in grace period');
        return next();
      } catch {
        // Fall through to reject
      }
    }
  }

  logger.warn({ event: 'jwt_invalid', path: req.path }, 'Invalid token rejected');
  res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
};
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

/**
 * Verify access token for WebSocket connections
 * Returns token payload with expiry info, or error details for hardened auth
 * @param token JWT access token from Authorization header or WebSocket query param
 * @returns verification result with payload (including exp) or error details
 */
export function verifyAccessTokenForWebSocket(token: string):
    | { ok: true; payload: AccessJwtPayload; expiresAt: Date }
    | { ok: false; reason: 'expired' | 'invalid' | 'missing_secret'; message: string } {
    if (!token) {
        return { ok: false, reason: 'invalid', message: 'Token is required' }
    }

    const currentSecret = process.env.JWT_SECRET
    if (!currentSecret || currentSecret.length < 32) {
        return { ok: false, reason: 'missing_secret', message: 'JWT secret not configured' }
    }

    const currentResult = verifyWithSecretAndExp(token, currentSecret)
    if (currentResult.ok) return currentResult
    if (currentResult.reason === 'expired') return currentResult

    const previousSecret = process.env.JWT_PREVIOUS_SECRET
    if (!isPreviousSecretWithinGracePeriod(previousSecret)) {
        return currentResult
    }

    return verifyWithSecretAndExp(token, previousSecret as string)
}

function verifyWithSecretAndExp(token: string, secret: string):
    | { ok: true; payload: AccessJwtPayload; expiresAt: Date }
    | { ok: false; reason: 'expired' | 'invalid'; message: string } {
    try {
        const decoded = jwt.verify(token, secret) as jwt.JwtPayload
        if (!isAccessPayload(decoded)) {
            return { ok: false, reason: 'invalid', message: 'Invalid token payload' }
        }

        // Extract expiry from JWT
        const expiryTimestamp = decoded.exp ? decoded.exp * 1000 : null
        if (!expiryTimestamp) {
            return { ok: false, reason: 'invalid', message: 'Token missing exp claim' }
        }

        return { ok: true, payload: decoded, expiresAt: new Date(expiryTimestamp) }
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return { ok: false, reason: 'expired', message: 'Token has expired' }
        }
        return { ok: false, reason: 'invalid', message: error instanceof Error ? error.message : 'Token verification failed' }
    }
}
