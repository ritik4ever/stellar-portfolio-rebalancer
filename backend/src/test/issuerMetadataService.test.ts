import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StellarToml, Horizon } from '@stellar/stellar-sdk'
import {
  fetchIssuerMetadata,
  getCachedMetadata,
  getMetadata
} from '../services/issuerMetadataService.js'

describe('IssuerMetadataService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches metadata from a domain and caches the result', async () => {
    const mockToml = {
      ORG_NAME: 'Test Org',
      ORG_URL: 'https://test.org',
      ORG_LOGO: 'https://test.org/logo.png',
      ORG_DESCRIPTION: 'A test organization description',
      VERSION: '1.0.0'
    }

    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValue(mockToml)

    const domain = 'test.org'
    const result1 = await fetchIssuerMetadata(domain)

    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(resolveSpy).toHaveBeenCalledWith(domain)
    expect(result1).toEqual({
      org_name: 'Test Org',
      org_url: 'https://test.org',
      org_logo: 'https://test.org/logo.png',
      org_description: 'A test organization description',
      version: '1.0.0'
    })

    // Second fetch should hit the cache (resolveSpy should not be called again)
    const result2 = await fetchIssuerMetadata(domain)
    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(result2).toEqual(result1)

    // Verify helper getCachedMetadata returns cached entry
    const cached = getCachedMetadata(domain)
    expect(cached).toEqual(result1)
  })

  it('expires cached metadata after TTL', async () => {
    const mockToml = { ORG_NAME: 'Expired Org' }
    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValue(mockToml)

    const domain = 'expired.org'
    await fetchIssuerMetadata(domain)
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    // Advance time by 6 hours + 1 ms (default TTL is 6h)
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1)

    await fetchIssuerMetadata(domain)
    expect(resolveSpy).toHaveBeenCalledTimes(2)
  })

  it('resolves home domain of an issuer account and returns metadata', async () => {
    const mockAccount = {
      home_domain: 'issuer-domain.com'
    }
    const loadAccountSpy = vi
      .spyOn(Horizon.Server.prototype, 'loadAccount')
      .mockResolvedValue(mockAccount as any)

    const mockToml = {
      ORG_NAME: 'Issuer Org'
    }
    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValue(mockToml)

    const issuerAccount = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const result = await getMetadata(issuerAccount)

    expect(loadAccountSpy).toHaveBeenCalledWith(issuerAccount)
    expect(resolveSpy).toHaveBeenCalledWith('issuer-domain.com')
    expect(result).toEqual({
      org_name: 'Issuer Org',
      org_url: undefined,
      org_logo: undefined,
      org_description: undefined,
      version: undefined
    })
  })

  it('returns undefined gracefully if issuer account has no home domain', async () => {
    const mockAccount = {
      home_domain: undefined
    }
    const loadAccountSpy = vi
      .spyOn(Horizon.Server.prototype, 'loadAccount')
      .mockResolvedValue(mockAccount as any)

    const issuerAccount = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const result = await getMetadata(issuerAccount)

    expect(loadAccountSpy).toHaveBeenCalledWith(issuerAccount)
    expect(result).toBeUndefined()
  })

  it('returns undefined gracefully if Horizon call fails', async () => {
    const loadAccountSpy = vi
      .spyOn(Horizon.Server.prototype, 'loadAccount')
      .mockRejectedValue(new Error('Horizon offline'))

    const issuerAccount = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const result = await getMetadata(issuerAccount)

    expect(loadAccountSpy).toHaveBeenCalledWith(issuerAccount)
    expect(result).toBeUndefined()
  })
})
