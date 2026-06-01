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
