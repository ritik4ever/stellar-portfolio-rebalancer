import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as connection from '../../queue/connection.js';
import { logger } from '../../utils/logger.js';
import { StartupConfig } from '../../config/startupConfig.js';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('probeRedis', () => {
  const mockConfig: StartupConfig = {
    queueStartupRetries: 3,
    queueStartupInitialDelayMs: 10,
    queueStartupMaxDelayMs: 50,
    // add other required fields to satisfy type
    nodeEnv: 'test',
    port: 3001,
    stellarNetwork: 'testnet',
    stellarHorizonUrl: 'http://localhost',
    stellarContractAddress: 'C123',
    autoRebalancerEnabled: false,
    corsOrigins: [],
    hasRebalanceSigner: true,
    jwtAuthEnabled: false,
    featureFlags: {},
    metricsAllowlist: [],
    readinessCacheTtlMs: 2000,
    consentAuditRetentionDays: 365,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true immediately if Redis is available', async () => {
    vi.resetModules();
    const freshConnection = await import('../../queue/connection.js');
    const spy = vi.spyOn(freshConnection.redisProbe, 'isAvailable').mockResolvedValue(true);

    const result = await freshConnection.probeRedis(mockConfig);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should retry and eventually succeed if Redis becomes available', async () => {
    vi.resetModules();
    const freshConnection = await import('../../queue/connection.js');

    const spy = vi.spyOn(freshConnection.redisProbe, 'isAvailable')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await freshConnection.probeRedis(mockConfig);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('should return false after reaching max retries if Redis remains unavailable', async () => {
    vi.resetModules();
    const freshConnection = await import('../../queue/connection.js');

    const spy = vi.spyOn(freshConnection.redisProbe, 'isAvailable').mockResolvedValue(false);

    const result = await freshConnection.probeRedis(mockConfig);

    expect(result).toBe(false);
    expect(spy).toHaveBeenCalledTimes(mockConfig.queueStartupRetries);
    expect(logger.warn).toHaveBeenCalledTimes(mockConfig.queueStartupRetries - 1);
  });
});
