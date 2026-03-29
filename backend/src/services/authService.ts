
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createRefreshToken,
  findRefreshToken,
  deleteRefreshTokenById,
  deleteAllRefreshTokensForUser,
  generateRefreshTokenId,
} from "../db/refreshTokenDb.js";
import { logger } from "../utils/logger.js";

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

export async function issueTokens(address: string): Promise<AuthTokens> {
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
  return issueTokens(row.user_address);
}

// ── Issue #171: wallet-signed challenge authentication ────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
}

const challengeStore = new Map<string, ChallengeEntry>();

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
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    challengeStore.delete(address);
    return false;
  }
  challengeStore.delete(address);
  try {
    const keypair = Keypair.fromPublicKey(address);
    const messageBuffer = Buffer.from(entry.nonce, "utf8");
    const sigBuffer = Buffer.from(signatureB64, "base64");
    return keypair.verify(messageBuffer, sigBuffer);
  } catch {
    return false;
  }
}


export async function logout(
  refreshToken: string | undefined,
  address: string | undefined,
): Promise<boolean> {
  if (refreshToken) {
    const row = await findRefreshToken(refreshToken);
    if (row) {
      await deleteRefreshTokenById(row.id).catch(() => {});
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
      return true;
    }
  }
  return false;
}
