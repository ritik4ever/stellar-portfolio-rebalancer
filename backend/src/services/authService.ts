
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createRefreshToken,
  findRefreshToken,
  findRefreshTokenById,
  deleteRefreshTokenById,
  deleteAllRefreshTokensForUser,
  generateRefreshTokenId,
  touchRefreshToken,
  advanceRefreshTokenFamily,
  createRefreshTokenFamily,
  findRotatedRefreshToken,
  generateRefreshTokenFamilyId,
  getRefreshTokenFamily,
  recordRotatedRefreshToken,
  revokeRefreshTokenFamily,
} from "../db/refreshTokenDb.js";
import { logger, logAudit } from "../utils/logger.js";
import { recordAuthSecurityEvent } from "../observability/metrics.js";
import { tokenRevocationService } from "./tokenRevocation.js";
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

function getJwtSecret(): string {
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

function recordAuthAuditEvent(event: AuthAuditEvent): void {
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

/**
 * Issue a fresh access/refresh pair.
 *
 * When `family` is omitted a brand-new token family is opened (a new login).
 * `refreshTokens` passes the existing family so a rotation stays inside the
 * chain it belongs to.
 */
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

/**
 * Single-use refresh token rotation (#1406).
 *
 * A successful refresh retires the presented token — it is recorded in the
 * rotated-out index and deleted — and issues the next generation inside the same
 * family. Presenting an already-rotated token is treated as a compromise signal:
 * the entire family is revoked, logging every sibling session out, while other
 * families (the user's other devices) are left alone.
 */
export async function refreshTokens(
  refreshToken: string,
): Promise<AuthTokens | null> {
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

  const row = await findRefreshToken(refreshToken);
  if (!row) {
    await handleRefreshTokenReuse(refreshToken, tokenHash);
    return null;
  }

  // A live token whose family was already revoked must not be honoured.
  if (row.family_id) {
    const family = await getRefreshTokenFamily(row.family_id);
    if (family?.revoked) {
      await deleteRefreshTokenById(row.id).catch(() => {});
      logger.warn('Refresh attempted with a token from a revoked family', {
        userAddress: row.user_address,
        familyId: row.family_id,
      });
      return null;
    }
  }

  const secret = getJwtSecret();
  let remainingTtlSec = REFRESH_EXPIRY_SEC;
  try {
    const decoded = jwt.verify(refreshToken, secret) as TokenPayload & {
      jti?: string;
    };
    if (decoded.type !== "refresh") return null;
    if (decoded.exp) {
      remainingTtlSec = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
    }
  } catch {
    await deleteRefreshTokenById(row.id).catch(() => {});
    return null;
  }

  const familyId = row.family_id ?? generateRefreshTokenFamilyId();
  const generation = (row.generation ?? 0) + 1;

  // Tokens minted before this feature have no family; adopt them into one so the
  // very next rotation is protected.
  if (!row.family_id) {
    await createRefreshTokenFamily(familyId, row.user_address);
  }

  await tokenRevocationService.addRevokedToken(tokenHash, remainingTtlSec);
  await recordRotatedRefreshToken(refreshToken, familyId, row.generation ?? 0, row.expires_at);
  await deleteRefreshTokenById(row.id);

  const metadata: RefreshTokenMetadata = {
    ...(row.metadata || {}),
    lastUsedAt: new Date().toISOString(),
  };
  const result = await issueTokens(row.user_address, metadata, { familyId, generation });

  recordAuthAuditEvent({
    action: "refresh",
    userAddress: row.user_address,
    timestamp: new Date().toISOString(),
    sessionId: undefined,
    previousSessionId: row.id,
    details: { familyId, generation },
  });

  return result;
}

/**
 * Reuse detection. The rotated-out index is authoritative and works without
 * Redis; the revocation service is still consulted so tokens revoked by other
 * paths (logout-all) keep their previous behaviour.
 */
async function handleRefreshTokenReuse(
  refreshToken: string,
  tokenHash: string,
): Promise<void> {
  const rotated = await findRotatedRefreshToken(refreshToken);

  if (rotated) {
    const family = await getRefreshTokenFamily(rotated.family_id);
    const userAddress = family?.user_address ?? decodeSubject(refreshToken);
    const revokedCount = await revokeRefreshTokenFamily(rotated.family_id, 'reused_rotated_token');

    recordAuthAuditEvent({
      action: 'revocation',
      userAddress,
      timestamp: new Date().toISOString(),
      count: revokedCount,
      details: {
        reason: 'reused_rotated_token',
        familyId: rotated.family_id,
        replayedGeneration: rotated.generation,
      },
    });
    recordAuthSecurityEvent('suspicious_login');
    logger.warn('Reused rotated refresh token detected — token family revoked', {
      userAddress,
      familyId: rotated.family_id,
      replayedGeneration: rotated.generation,
      sessionsRevoked: revokedCount,
    });
    return;
  }

  // No rotation record — fall back to the revocation list (e.g. logout-all).
  const revoked = await tokenRevocationService.isRevoked(tokenHash);
  if (!revoked) return;

  const userAddress = decodeSubject(refreshToken);
  await deleteAllRefreshTokensForUser(userAddress);
  await tokenRevocationService.revokeAllForUser(userAddress);
  recordAuthAuditEvent({
    action: 'revocation',
    userAddress,
    timestamp: new Date().toISOString(),
    details: { reason: 'reused_revoked_token' },
  });
  logger.warn('Reused revoked refresh token detected — all sessions revoked', { userAddress });
}

function decodeSubject(token: string): string {
  try {
    const decoded = jwt.decode(token) as (TokenPayload & { sub?: string }) | null;
    return decoded?.sub || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Issue #171: wallet-signed challenge authentication ────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
}

const challengeStore = new Map<string, ChallengeEntry>();

// ── Issue #423: suspicious login heuristics ───────────────────────────────────

const FAILED_SIG_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const FAILED_SIG_THRESHOLD = 5;

interface FailedAttemptRecord {
  count: number;
  windowStart: number;
}

const failedSigAttempts = new Map<string, FailedAttemptRecord>();

function recordFailedSignature(address: string): void {
  const now = Date.now();
  const record = failedSigAttempts.get(address);

  if (!record || now - record.windowStart > FAILED_SIG_WINDOW_MS) {
    failedSigAttempts.set(address, { count: 1, windowStart: now });
    return;
  }

  record.count += 1;

  if (record.count >= FAILED_SIG_THRESHOLD) {
    recordAuthSecurityEvent("suspicious_login");
    logAudit("suspicious_login_detected", {
      address,
      failedAttempts: record.count,
      windowMs: FAILED_SIG_WINDOW_MS,
    });
    logger.warn("Suspicious login: repeated signature failures", {
      address,
      failedAttempts: record.count,
    });
  }
}

export function getFailedSigAttempts(address: string): number {
  const now = Date.now();
  const record = failedSigAttempts.get(address);
  if (!record || now - record.windowStart > FAILED_SIG_WINDOW_MS) return 0;
  return record.count;
}

export function issueChallenge(address: string): string {
  challengeStore.delete(address);
  const nonce = randomBytes(32).toString("hex");
  const message = `stellar-rebalancer:auth:${nonce}`;
  challengeStore.set(address, {
    nonce: message,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  logger.info("Auth challenge issued", { address });
  return message;
}

export function verifyWalletSignature(
  address: string,
  signatureB64: string,
): boolean {
  const entry = challengeStore.get(address);
  if (!entry) {
    recordAuthSecurityEvent("expired_challenge");
    logAudit("auth_expired_challenge", { address });
    logger.warn("Auth attempt with no active challenge", { address });
    return false;
  }
  if (Date.now() > entry.expiresAt) {
    challengeStore.delete(address);
    recordAuthSecurityEvent("expired_challenge");
    logAudit("auth_expired_challenge", { address });
    logger.warn("Auth attempt with expired challenge", { address });
    return false;
  }
  challengeStore.delete(address);
  try {
    const keypair = Keypair.fromPublicKey(address);
    const messageBuffer = Buffer.from(entry.nonce, "utf8");
    const sigBuffer = Buffer.from(signatureB64, "base64");
    const valid = keypair.verify(messageBuffer, sigBuffer);
    if (!valid) {
      recordAuthSecurityEvent("failed_signature");
      logAudit("auth_failed_signature", { address });
      recordFailedSignature(address);
    }
    return valid;
  } catch {
    recordAuthSecurityEvent("failed_signature");
    logAudit("auth_failed_signature", { address });
    recordFailedSignature(address);
    return false;
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
