// src/services/issuerMetadataService.ts
// Service to fetch and cache issuer metadata from stellar.toml

import { Horizon, StellarToml } from '@stellar/stellar-sdk';
import type { IssuerMetadata } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration for the issuer metadata cache.
 * TTL is taken from environment variable ISSUER_METADATA_TTL_MS (default 6h).
 */
const CACHE_TTL_MS = Number(process.env.ISSUER_METADATA_TTL_MS) || 6 * 60 * 60 * 1000; // 6 hours

type CacheEntry = {
  data: IssuerMetadata;
  fetchedAt: number;
  expires: number;
};

const cache = new Map<string, CacheEntry>();

const network = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
const horizonUrl = process.env.STELLAR_HORIZON_URL || 
  (network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
const server = new Horizon.Server(horizonUrl);

/**
 * Result of a metadata fetch that conveys cache provenance, so callers can tell
 * a live response from stale (expired) data that was only served because the
 * network refetch failed.
 */
export interface IssuerMetadataResult {
  data: IssuerMetadata;
  stale: boolean;
  fetchedAtMs: number;
  expiresAtMs: number;
  source: 'cache' | 'network' | 'stale';
}

function toMetadata(toml: Awaited<ReturnType<typeof StellarToml.Resolver.resolve>>): IssuerMetadata {
  return {
    org_name: toml?.ORG_NAME,
    org_url: toml?.ORG_URL,
    org_logo: toml?.ORG_LOGO,
    org_description: toml?.ORG_DESCRIPTION,
    version: toml?.VERSION,
  };
}

/**
 * Resolve metadata for a domain with cache semantics.
 *
 * - A fresh cache entry is returned immediately (source: 'cache').
 * - A miss (or forced refresh) fetches from the network and repopulates the cache.
 * - If the network fetch fails and a (possibly expired) entry exists, the stale
 *   entry is served with `stale: true` (source: 'stale') instead of erroring.
 * - If the fetch fails and there is nothing cached, the error propagates.
 */
async function loadIssuerMetadataWithStatus(
  domain: string,
  options?: { forceRefresh?: boolean }
): Promise<IssuerMetadataResult> {
  const now = Date.now();
  const cached = cache.get(domain);
  const forceRefresh = !!options?.forceRefresh;

  if (cached && cached.expires > now && !forceRefresh) {
    logger.debug('[IssuerMetadata] Cache hit', { domain });
    return {
      data: cached.data,
      stale: false,
      fetchedAtMs: cached.fetchedAt,
      expiresAtMs: cached.expires,
      source: 'cache',
    };
  }

  logger.debug('[IssuerMetadata] Fetching from network', { domain, forceRefresh });
  try {
    const toml = await StellarToml.Resolver.resolve(domain);
    const data = toMetadata(toml);
    const fetchedAt = Date.now();
    const expires = fetchedAt + CACHE_TTL_MS;
    cache.set(domain, { data, fetchedAt, expires });
    return { data, stale: false, fetchedAtMs: fetchedAt, expiresAtMs: expires, source: 'network' };
  } catch (error) {
    if (cached) {
      logger.warn('[IssuerMetadata] Network fetch failed; serving stale cached metadata', {
        domain,
        error: String(error),
      });
      return {
        data: cached.data,
        stale: true,
        fetchedAtMs: cached.fetchedAt,
        expiresAtMs: cached.expires,
        source: 'stale',
      };
    }
    logger.warn('[IssuerMetadata] Network fetch failed (nothing cached to serve)', {
      domain,
      error: String(error),
    });
    throw error;
  }
}

/**
 * Resolve the home domain from the issuer account and fetch its stellar.toml.
 * Returns parsed metadata or throws an error if fetching/parsing fails.
 */
export async function fetchIssuerMetadata(
  domain: string,
  options?: { forceRefresh?: boolean }
): Promise<IssuerMetadata> {
  const result = await fetchIssuerMetadataWithStatus(domain, options);
  return result.data;
}

/**
 * Domain-level variant that surfaces cache provenance / staleness.
 */
export async function fetchIssuerMetadataWithStatus(
  domain: string,
  options?: { forceRefresh?: boolean }
): Promise<IssuerMetadataResult> {
  return loadIssuerMetadataWithStatus(domain, options);
}

/**
 * Helper to get cached metadata without network request.
 */
export function getCachedMetadata(domain: string): IssuerMetadata | undefined {
  const entry = cache.get(domain);
  if (entry && entry.expires > Date.now()) {
    return entry.data;
  }
  return undefined;
}

/**
 * Main entry point: Get metadata for an issuer account by resolving its home domain.
 * Kept backward compatible — failures resolve to `undefined`.
 */
export async function getMetadata(issuerAccount: string): Promise<IssuerMetadata | undefined> {
  try {
    logger.debug('[IssuerMetadata] Loading account from Horizon', { issuerAccount });
    const account = await server.loadAccount(issuerAccount);
    const homeDomain = account.home_domain;
    if (!homeDomain) {
      logger.debug('[IssuerMetadata] Account has no home domain', { issuerAccount });
      return undefined;
    }
    return await fetchIssuerMetadata(homeDomain);
  } catch (error) {
    logger.warn('[IssuerMetadata] Failed to load account/metadata', { issuerAccount, error: String(error) });
    return undefined;
  }
}

/**
 * Account-level variant that surfaces cache provenance / staleness.
 */
export async function getMetadataWithStatus(issuerAccount: string): Promise<IssuerMetadataResult | undefined> {
  try {
    logger.debug('[IssuerMetadata] Loading account from Horizon', { issuerAccount });
    const account = await server.loadAccount(issuerAccount);
    const homeDomain = account.home_domain;
    if (!homeDomain) {
      logger.debug('[IssuerMetadata] Account has no home domain', { issuerAccount });
      return undefined;
    }
    return await loadIssuerMetadataWithStatus(homeDomain);
  } catch (error) {
    logger.warn('[IssuerMetadata] Failed to load account/metadata', { issuerAccount, error: String(error) });
    return undefined;
  }
}

/**
 * Force a manual refresh of the metadata for an issuer account, bypassing a
 * fresh cache entry. If the network fetch fails, an existing cached entry is
 * served flagged as stale (the caller decides how to surface that).
 */
export async function forceRefreshMetadata(issuerAccount: string): Promise<IssuerMetadataResult> {
  const account = await server.loadAccount(issuerAccount);
  const homeDomain = account.home_domain;
  if (!homeDomain) {
    throw new Error(`Issuer account ${issuerAccount} has no home domain to refresh`);
  }
  logger.info('[IssuerMetadata] Force-refreshing issuer metadata', { issuerAccount, homeDomain });
  return loadIssuerMetadataWithStatus(homeDomain, { forceRefresh: true });
}

/**
 * Stage-warming: prefetch metadata for the given issuer accounts so the cache is
 * hot before real traffic arrives (avoids serving stale/missing metadata right
 * after a deployment). Failures are logged and skipped without aborting the
 * startup sequence.
 */
export async function warmIssuerMetadataCache(issuerAccounts: string[]): Promise<number> {
  let warmed = 0;
  for (const issuerAccount of issuerAccounts) {
    try {
      const account = await server.loadAccount(issuerAccount);
      const homeDomain = account.home_domain;
      if (homeDomain) {
        const result = await loadIssuerMetadataWithStatus(homeDomain);
        if (result.source === 'network' || result.source === 'cache') {
          warmed += 1;
        }
        logger.debug('[IssuerMetadata] Cache warmed', { issuerAccount, homeDomain, source: result.source });
      }
    } catch (error) {
      logger.warn('[IssuerMetadata] Cache warm-up failed for issuer', { issuerAccount, error: String(error) });
    }
  }
  return warmed;
}

export const issuerMetadataService = {
  fetchIssuerMetadata,
  fetchIssuerMetadataWithStatus,
  getCachedMetadata,
  getMetadata,
  getMetadataWithStatus,
  forceRefreshMetadata,
  warmIssuerMetadataCache,
  getCacheStats: () => ({
    entries: cache.size,
    ttlMs: CACHE_TTL_MS,
  }),
};