import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { logger, logAudit } from '../utils/logger.js';
import { recordAuthSecurityEvent } from '../observability/metrics.js';
import { authorizationContext, classifyChallengeReplay, detectOtherNetwork, recordChallengeDisposition, recordWalletAuthorization } from './walletAuthorization.js';
import type { WalletAuthorizationContext } from './walletAuthorization.js';

// ── Issue #171: wallet-signed challenge authentication ────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
  context: WalletAuthorizationContext;
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
  const context = authorizationContext(address, message);
  challengeStore.set(address, {
    nonce: message,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    context,
  });
  recordWalletAuthorization('wallet_signature', context, 'pending', 'challenge_issued');
  logger.info("Auth challenge issued", { address });
  return message;
}

function consumeVerifiedWalletSignature(
  address: string,
  signatureB64: string,
): WalletAuthorizationContext | undefined {
  const entry = challengeStore.get(address);
  if (!entry) {
    const replay = classifyChallengeReplay('wallet_signature', address);
    recordWalletAuthorization('wallet_signature', replay?.context ?? authorizationContext(address),
      'blocked', replay?.reason ?? 'missing_challenge', { retryable: false });
    recordAuthSecurityEvent("expired_challenge");
    logAudit("auth_expired_challenge", { address });
    logger.warn("Auth attempt with no active challenge", { address });
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    challengeStore.delete(address);
    recordChallengeDisposition('wallet_signature', 'expired', entry.context);
    recordWalletAuthorization('wallet_signature', entry.context, 'blocked', 'expired_challenge', { retryable: false });
    recordAuthSecurityEvent("expired_challenge");
    logAudit("auth_expired_challenge", { address });
    logger.warn("Auth attempt with expired challenge", { address });
    return undefined;
  }

  // Consume synchronously before any caller can await token persistence. This is
  // the single-use boundary for parallel login attempts in this process.
  challengeStore.delete(address);
  try {
    const keypair = Keypair.fromPublicKey(address);
    const messageBuffer = Buffer.from(entry.nonce, "utf8");
    const sigBuffer = Buffer.from(signatureB64, "base64");
    const valid = keypair.verify(messageBuffer, sigBuffer);
    if (!valid) {
      const detectedNetwork = detectOtherNetwork(keypair, sigBuffer, entry.nonce, entry.context.expectedNetwork);
      recordWalletAuthorization('wallet_signature', entry.context, 'blocked', detectedNetwork ? 'wrong_network' : 'invalid_signature', {
        retryable: false,
        ...(detectedNetwork ? { detectedNetwork } : {}),
      });
      recordAuthSecurityEvent("failed_signature");
      logAudit("auth_failed_signature", { address });
      recordFailedSignature(address);
      return undefined;
    }

    recordChallengeDisposition('wallet_signature', 'consumed', entry.context);
    return entry.context;
  } catch {
    recordWalletAuthorization('wallet_signature', entry.context, 'blocked', 'invalid_signature', { retryable: false });
    recordAuthSecurityEvent("failed_signature");
    logAudit("auth_failed_signature", { address });
    recordFailedSignature(address);
    return undefined;
  }
}

/**
 * Verify a signed challenge without issuing tokens. Kept for the existing
 * service-level helper contract; the mounted login route uses
 * authenticateWalletSignature so success is not recorded before persistence.
 */
export function verifyWalletSignature(
  address: string,
  signatureB64: string,
): boolean {
  const context = consumeVerifiedWalletSignature(address, signatureB64);
  if (!context) return false;
  recordWalletAuthorization('wallet_signature', context, 'success', 'authorized');
  return true;
}

/**
 * Complete the wallet login as one observable operation: a valid signature is
 * consumed synchronously, token issuance is marked pending, and a terminal
 * outcome is recorded only after persistence succeeds or fails.
 */
export async function authenticateWalletSignature<T>(
  address: string,
  signatureB64: string,
  issueTokens: () => Promise<T>,
): Promise<T | null> {
  const context = consumeVerifiedWalletSignature(address, signatureB64);
  if (!context) return null;

  recordWalletAuthorization('wallet_signature', context, 'pending', 'issuing_tokens');
  try {
    const tokens = await issueTokens();
    recordWalletAuthorization('wallet_signature', context, 'success', 'authorized');
    return tokens;
  } catch (error) {
    recordWalletAuthorization('wallet_signature', context, 'blocked', 'token_issuance_failed', { retryable: false });
    throw error;
  }
}
