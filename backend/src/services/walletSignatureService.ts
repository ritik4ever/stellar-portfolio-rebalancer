import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { logger, logAudit } from '../utils/logger.js';
import { recordAuthSecurityEvent } from '../observability/metrics.js';
import { authorizationContext, detectOtherNetwork, recordWalletAuthorization } from './walletAuthorization.js';
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

export function verifyWalletSignature(
  address: string,
  signatureB64: string,
): boolean {
  const entry = challengeStore.get(address);
  if (!entry) {
    recordWalletAuthorization('wallet_signature', authorizationContext(address), 'blocked', 'missing_challenge', { retryable: false });
    recordAuthSecurityEvent("expired_challenge");
    logAudit("auth_expired_challenge", { address });
    logger.warn("Auth attempt with no active challenge", { address });
    return false;
  }
  if (Date.now() > entry.expiresAt) {
    challengeStore.delete(address);
    recordWalletAuthorization('wallet_signature', entry.context, 'blocked', 'expired_challenge', { retryable: false });
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
      const detectedNetwork = detectOtherNetwork(keypair, sigBuffer, entry.nonce, entry.context.expectedNetwork);
      recordWalletAuthorization('wallet_signature', entry.context, 'blocked', detectedNetwork ? 'wrong_network' : 'invalid_signature', {
        retryable: false,
        ...(detectedNetwork ? { detectedNetwork } : {}),
      });
      recordAuthSecurityEvent("failed_signature");
      logAudit("auth_failed_signature", { address });
      recordFailedSignature(address);
    } else {
      recordWalletAuthorization('wallet_signature', entry.context, 'success', 'authorized');
    }
    return valid;
  } catch {
    recordWalletAuthorization('wallet_signature', entry.context, 'blocked', 'invalid_signature', { retryable: false });
    recordAuthSecurityEvent("failed_signature");
    logAudit("auth_failed_signature", { address });
    recordFailedSignature(address);
    return false;
  }
}
