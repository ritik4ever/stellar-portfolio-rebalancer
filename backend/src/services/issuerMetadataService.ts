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
  expires: number;
};

const cache = new Map<string, CacheEntry>();

const network = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
const horizonUrl = process.env.STELLAR_HORIZON_URL || 
  (network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
const server = new Horizon.Server(horizonUrl);

/**
 * Resolve the home domain from the issuer account and fetch its stellar.toml.
 * Returns parsed metadata or throws an error if fetching/parsing fails.
 */
export async function fetchIssuerMetadata(domain: string): Promise<IssuerMetadata> {
  const now = Date.now();
  const cached = cache.get(domain);
  if (cached && cached.expires > now) {
    logger.debug('[IssuerMetadata] Cache hit', { domain });
    return cached.data;
  }

  logger.debug('[IssuerMetadata] Fetching from network', { domain });
  const toml = await StellarToml.Resolver.resolve(domain);
  // Select fields we care about – extend as needed.
  const metadata: IssuerMetadata = {
    org_name: toml?.ORG_NAME,
    org_url: toml?.ORG_URL,
    org_logo: toml?.ORG_LOGO,
    org_description: toml?.ORG_DESCRIPTION,
    version: toml?.VERSION,
    // Additional optional fields can be added here.
  };

  cache.set(domain, { data: metadata, expires: now + CACHE_TTL_MS });
  return metadata;
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

export const issuerMetadataService = {
  fetchIssuerMetadata,
  getCachedMetadata,
  getMetadata
};
