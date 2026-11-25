import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import {
  findRefreshToken, deleteRefreshTokenById, deleteAllRefreshTokensForUser,
  generateRefreshTokenFamilyId, getRefreshTokenFamily, revokeRefreshTokenFamily,
  createRefreshTokenFamily, recordRotatedRefreshToken, findRotatedRefreshToken,
} from '../db/refreshTokenDb.js';
import { logger } from '../utils/logger.js';
import { recordAuthSecurityEvent } from '../observability/metrics.js';
import { tokenRevocationService } from './tokenRevocation.js';
import { getAuthConfig, getJwtSecret, issueTokens, recordAuthAuditEvent } from './tokenService.js';
import type { TokenPayload, AuthTokens } from './tokenService.js';
import type { RefreshTokenMetadata } from '../types/index.js';

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
  let remainingTtlSec = getAuthConfig().refreshExpirySec;
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
