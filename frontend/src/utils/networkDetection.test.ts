import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseStellarNetworkPassphrase,
  getConfiguredNetwork,
} from './networkDetection'

describe('networkDetection', () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    vi.stubGlobal('window', {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('parseStellarNetworkPassphrase', () => {
    it('detects testnet from passphrase', () => {
      expect(parseStellarNetworkPassphrase('Test SDF Network ; September 2015')).toBe('testnet')
    })

    it('detects mainnet from passphrase', () => {
      expect(parseStellarNetworkPassphrase('Public Global Stellar Network ; September 2015')).toBe('mainnet')
    })

    it('detects standalone from passphrase', () => {
      expect(parseStellarNetworkPassphrase('Standalone Network ; February 2017')).toBe('standalone')
    })

    it('detects futurenet from passphrase', () => {
      expect(parseStellarNetworkPassphrase('Future Network ; October 2022')).toBe('futurenet')
    })

    it('returns unknown for unrecognized passphrase', () => {
      expect(parseStellarNetworkPassphrase('Custom Network')).toBe('unknown')
    })
  })

  describe('getConfiguredNetwork', () => {
    it('returns testnet by default', () => {
      expect(getConfiguredNetwork()).toBe('testnet')
    })
  })
})
