import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StellarToml, Horizon } from '@stellar/stellar-sdk'
import {
  fetchIssuerMetadata,
  getCachedMetadata,
  getMetadata,
  fetchIssuerMetadataWithStatus,
  getMetadataWithStatus,
  forceRefreshMetadata,
  warmIssuerMetadataCache
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

  it('serves stale cached metadata with a staleness flag when a refetch fails', async () => {
    const mockToml = { ORG_NAME: 'Stale Org', VERSION: '1.0.0' }
    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValue(mockToml)

    const domain = 'stale.org'
    // Populate the cache, then let the entry expire so the next read refetches.
    await fetchIssuerMetadata(domain)
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1)

    // The network refetch fails, so the expired entry is served flagged stale.
    resolveSpy.mockRejectedValue(new Error('TOML host unreachable'))
    const status = await fetchIssuerMetadataWithStatus(domain)

    expect(resolveSpy).toHaveBeenCalledTimes(2)
    expect(status.stale).toBe(true)
    expect(status.source).toBe('stale')
    expect(status.data.org_name).toBe('Stale Org')
    expect(status.fetchedAtMs).toBeGreaterThan(0)
    expect(status.expiresAtMs).toBeLessThanOrEqual(status.fetchedAtMs + 6 * 60 * 60 * 1000)
  })

  it('still propagates a fetch failure when nothing is cached to serve', async () => {
    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockRejectedValue(new Error('TOML host unreachable'))

    await expect(fetchIssuerMetadata('missing.org')).rejects.toThrow('TOML host unreachable')
    expect(resolveSpy).toHaveBeenCalledTimes(1)
  })

  it('force refresh bypasses a fresh cache entry', async () => {
    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValueOnce({ ORG_NAME: 'Cached Org' })
      .mockResolvedValueOnce({ ORG_NAME: 'Refreshed Org' })

    const domain = 'refresh.org'
    await fetchIssuerMetadata(domain)
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    const status = await fetchIssuerMetadataWithStatus(domain, { forceRefresh: true })

    expect(resolveSpy).toHaveBeenCalledTimes(2)
    expect(status.source).toBe('network')
    expect(status.stale).toBe(false)
    expect(status.data.org_name).toBe('Refreshed Org')
  })

  it('forceRefreshMetadata refetches for an issuer account', async () => {
    const loadAccountSpy = vi
      .spyOn(Horizon.Server.prototype, 'loadAccount')
      .mockResolvedValue({ home_domain: 'issuer-refresh.com' } as any)

    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValueOnce({ ORG_NAME: 'First Org' })
      .mockResolvedValueOnce({ ORG_NAME: 'Second Org' })

    const issuerAccount = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const first = await forceRefreshMetadata(issuerAccount)
    expect(loadAccountSpy).toHaveBeenCalledWith(issuerAccount)
    expect(first.data.org_name).toBe('First Org')
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    // Forced refresh bypasses the now-hot cache.
    const second = await forceRefreshMetadata(issuerAccount)
    expect(resolveSpy).toHaveBeenCalledTimes(2)
    expect(second.data.org_name).toBe('Second Org')
    expect(second.stale).toBe(false)
  })

  it('getMetadataWithStatus reports cache provenance for an account', async () => {
    const mockAccount = { home_domain: 'status-domain.com' }
    vi.spyOn(Horizon.Server.prototype, 'loadAccount').mockResolvedValue(mockAccount as any)

    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValue({ ORG_NAME: 'Status Org' })

    const issuerAccount = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const cold = await getMetadataWithStatus(issuerAccount)
    expect(cold?.source).toBe('network')
    expect(cold?.data.org_name).toBe('Status Org')
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    const hot = await getMetadataWithStatus(issuerAccount)
    expect(hot?.source).toBe('cache')
    expect(resolveSpy).toHaveBeenCalledTimes(1)
  })

  it('warmIssuerMetadataCache prefetches metadata for the configured issuers', async () => {
    const mockAccount = { home_domain: 'warm-domain.com' }
    vi.spyOn(Horizon.Server.prototype, 'loadAccount').mockResolvedValue(mockAccount as any)

    const resolveSpy = vi
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValue({ ORG_NAME: 'Warm Org' })

    const issuerAccount = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    const warmed = await warmIssuerMetadataCache([issuerAccount])
    expect(warmed).toBe(1)
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    // Cache is hot for the warm-up domain now.
    const status = await getMetadataWithStatus(issuerAccount)
    expect(status?.source).toBe('cache')
    expect(resolveSpy).toHaveBeenCalledTimes(1)
  })
})
