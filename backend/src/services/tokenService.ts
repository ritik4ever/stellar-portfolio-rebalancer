
import jwt from "jsonwebtoken";
import {
  createRefreshToken, findRefreshToken, findRefreshTokenById, deleteRefreshTokenById,
  deleteAllRefreshTokensForUser, generateRefreshTokenId,
  advanceRefreshTokenFamily, createRefreshTokenFamily, generateRefreshTokenFamilyId,
} from '../db/refreshTokenDb.js';
import { logger, logAudit } from "../utils/logger.js";
import type { RefreshTokenMetadata } from "../types/index.js";

const ACCESS_EXPIRY_SEC = parseInt(
  process.env.JWT_ACCESS_EXPIRY_SEC || "900",
  10,
);
const REFRESH_EXPIRY_SEC = parseInt(
  process.env.JWT_REFRESH_EXPIRY_SEC || "604800",
  10,
);

const MIN_SECRET_LENGTH = 32;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters. ` +
        "Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return secret;
}

export interface TokenPayload {
  sub: string;
  type: "access" | "refresh";
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export type AuthAuditAction = "login" | "refresh" | "revocation";

export interface AuthAuditEvent {
  action: AuthAuditAction;
  userAddress: string;
  timestamp: string;
  sessionId?: string;
  previousSessionId?: string;
  count?: number;
  details?: Record<string, unknown>;
}

const MAX_AUTH_AUDIT_EVENTS = 100;
const authAuditEvents: AuthAuditEvent[] = [];

export function recordAuthAuditEvent(event: AuthAuditEvent): void {
  authAuditEvents.push(event);
  while (authAuditEvents.length > MAX_AUTH_AUDIT_EVENTS) {
    authAuditEvents.shift();
  }
  logAudit(`auth_${event.action}`, {
    userAddress: event.userAddress,
    sessionId: event.sessionId,
    previousSessionId: event.previousSessionId,
    count: event.count,
    ...event.details,
  });
}

export function getRecentAuthAuditEvents(limit = 50): AuthAuditEvent[] {
  return authAuditEvents.slice(-limit).reverse();
}

export function getAuthConfig(): {
  enabled: boolean;
  accessExpirySec: number;
  refreshExpirySec: number;
} {
  const secretSet = Boolean(
    process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32,
  );
  return {
    enabled: secretSet,
    accessExpirySec: ACCESS_EXPIRY_SEC,
    refreshExpirySec: REFRESH_EXPIRY_SEC,
  };
}

export function generateAccessToken(address: string): string {
  return jwt.sign(
    { sub: address, type: "access" } as TokenPayload,
    getJwtSecret(),
    { expiresIn: ACCESS_EXPIRY_SEC },
  );
}


export async function issueTokens(
  address: string,
  metadata?: RefreshTokenMetadata | null,
  family?: { familyId: string; generation: number },
): Promise<AuthTokens> {
  const isNewFamily = !family;
  const familyId = family?.familyId ?? generateRefreshTokenFamilyId();
  const generation = family?.generation ?? 0;

  if (isNewFamily) {
    await createRefreshTokenFamily(familyId, address);
  }

  const accessToken = generateAccessToken(address);
  const refreshId = generateRefreshTokenId();
  const refreshToken = jwt.sign(
    { sub: address, type: "refresh", jti: refreshId, fid: familyId } as TokenPayload & {
      jti: string;
      fid: string;
    },
    getJwtSecret(),
    { expiresIn: REFRESH_EXPIRY_SEC },
  );
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SEC * 1000);

  await createRefreshToken(refreshId, address, refreshToken, expiresAt, metadata, {
    familyId,
    generation,
  });
  await advanceRefreshTokenFamily(familyId, generation);

  if (isNewFamily) {
    recordAuthAuditEvent({
      action: "login",
      userAddress: address,
      timestamp: new Date().toISOString(),
      sessionId: refreshId,
      details: { familyId },
    });
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRY_SEC,
    refreshExpiresIn: REFRESH_EXPIRY_SEC,
  };
}

export function verifyAccessToken(token: string): TokenPayload | null {
  const secret = getJwtSecret();
  try {
    const decoded = jwt.verify(token, secret) as TokenPayload;
    if (decoded.type !== "access") return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function revokeDeviceSession(
  userId: string,
  tokenId: string,
): Promise<{ success: boolean; reason?: string }> {
  const row = await findRefreshTokenById(tokenId);
  if (!row) return { success: false, reason: 'not_found' };
  if (row.user_address !== userId) return { success: false, reason: 'forbidden' };
  await deleteRefreshTokenById(tokenId);
  logger.info('Device session revoked', { userId, tokenId });
  return { success: true };
}

export async function logout(
  refreshToken: string | undefined,
  address: string | undefined,
): Promise<boolean> {
  if (refreshToken) {
    const row = await findRefreshToken(refreshToken);
    if (row) {
      await deleteRefreshTokenById(row.id).catch(() => {});
      recordAuthAuditEvent({
        action: "revocation",
        userAddress: row.user_address,
        timestamp: new Date().toISOString(),
        sessionId: row.id,
        details: { reason: "single_session" },
      });
      return true;
    }
  }
  if (address) {
    const count = await deleteAllRefreshTokensForUser(address);
    if (count > 0) {
      logger.info("All refresh tokens invalidated for user", {
        userId: address,
        count,
      });
      recordAuthAuditEvent({
        action: "revocation",
        userAddress: address,
        timestamp: new Date().toISOString(),
        count,
        details: { reason: "all_sessions" },
      });
      return true;
    }
  }
  return false;
}
