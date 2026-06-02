
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createRefreshToken,
  findRefreshToken,
  findRefreshTokenById,
  deleteRefreshTokenById,
  deleteAllRefreshTokensForUser,
  generateRefreshTokenId,
} from "../db/refreshTokenDb.js";
import { logger, logAudit } from "../utils/logger.js";

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

interface TokenCreationResult extends AuthTokens {
  refreshId: string;
}

async function createTokensForUser(address: string): Promise<TokenCreationResult> {
  const accessToken = generateAccessToken(address);
  const refreshId = generateRefreshTokenId();
  const refreshToken = jwt.sign(
    { sub: address, type: "refresh", jti: refreshId } as TokenPayload & {
      jti: string;
    },
    getJwtSecret(),
    { expiresIn: REFRESH_EXPIRY_SEC },
  );
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SEC * 1000);
  await createRefreshToken(refreshId, address, refreshToken, expiresAt);
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRY_SEC,
    refreshExpiresIn: REFRESH_EXPIRY_SEC,
    refreshId,
  };
}

export async function issueTokens(address: string): Promise<AuthTokens> {
  const result = await createTokensForUser(address);
  recordAuthAuditEvent({
    action: "login",
    userAddress: address,
    timestamp: new Date().toISOString(),
    sessionId: result.refreshId,
  });
  const { refreshId, ...tokens } = result;
  return tokens;
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

export async function refreshTokens(
  refreshToken: string,
): Promise<AuthTokens | null> {
  const row = await findRefreshToken(refreshToken);
  if (!row) return null;
  const secret = getJwtSecret();
  try {
    const decoded = jwt.verify(refreshToken, secret) as TokenPayload & {
      jti?: string;
    };
    if (decoded.type !== "refresh") return null;
  } catch {
    await deleteRefreshTokenById(row.id).catch(() => {});
    return null;
  }
  await deleteRefreshTokenById(row.id);
  const result = await createTokensForUser(row.user_address);
  recordAuthAuditEvent({
    action: "refresh",
    userAddress: row.user_address,
    timestamp: new Date().toISOString(),
    sessionId: result.refreshId,
    previousSessionId: row.id,
  });
  const { refreshId, ...tokens } = result;
  return tokens;
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
