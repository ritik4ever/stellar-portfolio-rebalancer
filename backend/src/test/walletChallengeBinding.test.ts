import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'

// Isolated doubles: no real DB or RPC is reachable from these tests.
const dbDouble = vi.hoisted(() => ({
  createRefreshToken: vi.fn().mockResolvedValue(undefined),
  createRefreshTokenFamily: vi.fn().mockResolvedValue(undefined),
  advanceRefreshTokenFamily: vi.fn().mockResolvedValue(undefined),
}))
const rpcDouble = vi.hoisted(() => ({ call: vi.fn() }))
const metricsDouble = vi.hoisted(() => ({ recordAuthSecurityEvent: vi.fn() }))

vi.mock('../db/refreshTokenDb.js', () => ({
  ...dbDouble,
  findRefreshToken: vi.fn(),
  findRefreshTokenById: vi.fn(),
  deleteRefreshTokenById: vi.fn(),
  deleteAllRefreshTokensForUser: vi.fn(),
  generateRefreshTokenId: vi.fn(() => 'rt-id'),
  touchRefreshToken: vi.fn(),
  findRotatedRefreshToken: vi.fn(),
  generateRefreshTokenFamilyId: vi.fn(() => 'family-id'),
  getRefreshTokenFamily: vi.fn(),
  recordRotatedRefreshToken: vi.fn(),
  revokeRefreshTokenFamily: vi.fn(),
}))
vi.mock('../observability/metrics.js', () => metricsDouble)
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAudit: vi.fn(),
}))
vi.mock('../services/tokenRevocation.js', () => ({
  tokenRevocationService: { isRevoked: vi.fn().mockResolvedValue(false) },
}))

import { issueChallenge, verifyWalletSignature } from '../services/authService.js'
import { createChallenge, verifyChallenge, InvalidSignatureError } from '../services/stellarAuthService.js'

const CHALLENGE_PREFIX = 'stellar-rebalancer:auth:'
const sign = (kp: Keypair, msg: string) => Buffer.from(kp.sign(Buffer.from(msg, 'utf8'))).toString('base64')

function expectNoSideEffects() {
  expect(dbDouble.createRefreshToken).not.toHaveBeenCalled()
  expect(dbDouble.createRefreshTokenFamily).not.toHaveBeenCalled()
  expect(dbDouble.advanceRefreshTokenFamily).not.toHaveBeenCalled()
  expect(rpcDouble.call).not.toHaveBeenCalled()
}

describe('wallet challenge binding (account, nonce, network)', () => {
  const keypair = Keypair.random()
  const address = keypair.publicKey()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    process.env.JWT_SECRET = 'x'.repeat(48)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('issueChallenge / verifyWalletSignature', () => {
    it('binds the challenge to account and nonce, and is single-use', () => {
      const message = issueChallenge(address)
      expect(message.startsWith(CHALLENGE_PREFIX)).toBe(true)
      const nonce = message.slice(CHALLENGE_PREFIX.length)
      expect(nonce).toMatch(/^[0-9a-f]{64}$/)

      const sig = sign(keypair, message)
      expect(verifyWalletSignature(address, sig)).toBe(true)
      // Reuse of the same signed challenge is rejected.
      expect(verifyWalletSignature(address, sig)).toBe(false)
      expect(metricsDouble.recordAuthSecurityEvent).toHaveBeenCalledWith('expired_challenge')
      expect(metricsDouble.recordAuthSecurityEvent).not.toHaveBeenCalledWith('failed_signature')
      expectNoSideEffects()
    })

    it('rejects an expired challenge even with a valid signature', () => {
      const message = issueChallenge(address)
      const sig = sign(keypair, message)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      expect(verifyWalletSignature(address, sig)).toBe(false)
      expect(metricsDouble.recordAuthSecurityEvent).toHaveBeenCalledWith('expired_challenge')
      // Expired challenge was purged: it cannot be revived.
      expect(verifyWalletSignature(address, sig)).toBe(false)
      expectNoSideEffects()
    })

    it('rejects a valid signature over the same nonce scoped to a different network', () => {
      const message = issueChallenge(address)
      const nonce = message.slice(CHALLENGE_PREFIX.length)
      const otherNetworkMessage = `${CHALLENGE_PREFIX}Test SDF Network ; September 2015:${nonce}`
      const sig = sign(keypair, otherNetworkMessage)
      expect(Keypair.fromPublicKey(address).verify(Buffer.from(otherNetworkMessage), Buffer.from(sig, 'base64'))).toBe(true)

      expect(verifyWalletSignature(address, sig)).toBe(false)
      expect(metricsDouble.recordAuthSecurityEvent).toHaveBeenCalledWith('failed_signature')
      // The challenge is consumed on failure; the genuine signature can no longer be replayed.
      expect(verifyWalletSignature(address, sign(keypair, message))).toBe(false)
      expectNoSideEffects()
    })

    it('rejects a signature from a different account for the bound challenge', () => {
      const other = Keypair.random()
      const message = issueChallenge(address)

      expect(verifyWalletSignature(address, sign(other, message))).toBe(false)
      expect(metricsDouble.recordAuthSecurityEvent).toHaveBeenCalledWith('failed_signature')
      expectNoSideEffects()
    })

    it('does not let a challenge issued to one account be used by another', () => {
      const other = Keypair.random()
      const message = issueChallenge(address)

      expect(verifyWalletSignature(other.publicKey(), sign(other, message))).toBe(false)
      expect(metricsDouble.recordAuthSecurityEvent).toHaveBeenCalledWith('expired_challenge')
      expectNoSideEffects()
    })
  })

  describe('createChallenge / verifyChallenge', () => {
    it('issues tokens exactly once; reuse creates no duplicate session', async () => {
      const nonce = createChallenge(address)
      const sig = sign(keypair, nonce)

      const tokens = await verifyChallenge(address, sig)
      expect(tokens.accessToken).toBeTruthy()
      expect(dbDouble.createRefreshTokenFamily).toHaveBeenCalledTimes(1)
      expect(dbDouble.createRefreshTokenFamily).toHaveBeenCalledWith('family-id', address)
      expect(dbDouble.createRefreshToken).toHaveBeenCalledTimes(1)
      expect(dbDouble.createRefreshToken.mock.calls[0][1]).toBe(address)

      await expect(verifyChallenge(address, sig)).rejects.toBeInstanceOf(InvalidSignatureError)
      expect(dbDouble.createRefreshTokenFamily).toHaveBeenCalledTimes(1)
      expect(dbDouble.createRefreshToken).toHaveBeenCalledTimes(1)
      expect(rpcDouble.call).not.toHaveBeenCalled()
    })

    it('rejects an expired challenge without issuing tokens', async () => {
      const nonce = createChallenge(address)
      const sig = sign(keypair, nonce)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      await expect(verifyChallenge(address, sig)).rejects.toThrow('Challenge expired')
      await expect(verifyChallenge(address, sig)).rejects.toThrow('No active challenge')
      expectNoSideEffects()
    })

    it('rejects a valid signature over the nonce scoped to a different network', async () => {
      const nonce = createChallenge(address)
      const sig = sign(keypair, `Public Global Stellar Network ; September 2015:${nonce}`)

      await expect(verifyChallenge(address, sig)).rejects.toThrow('Signature verification failed')
      expectNoSideEffects()

      // The bound nonce is still pending after a failed attempt and works for the correct message.
      const tokens = await verifyChallenge(address, sign(keypair, nonce))
      expect(tokens.refreshToken).toBeTruthy()
      expect(dbDouble.createRefreshToken).toHaveBeenCalledTimes(1)
    })

    it('does not accept another account\'s signature over the bound nonce', async () => {
      const other = Keypair.random()
      const nonce = createChallenge(address)

      await expect(verifyChallenge(address, sign(other, nonce))).rejects.toBeInstanceOf(InvalidSignatureError)
      await expect(verifyChallenge(other.publicKey(), sign(other, nonce))).rejects.toThrow('No active challenge')
      expectNoSideEffects()
    })
  })
})
