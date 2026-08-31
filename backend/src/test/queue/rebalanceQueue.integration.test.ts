import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { RedisMemoryServer } from 'redis-memory-server';
import IORedis from 'ioredis';

// Mock connection options to dynamically use the in-memory Redis URL
vi.mock('../../queue/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../queue/connection.js')>();
  return {
    ...actual,
    getConnectionOptions: () => {
      return {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
      };
    },
    isRedisAvailable: async () => true,
  };
});

// Mock external dependencies
vi.mock('../../services/notificationService.js', () => ({
  notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
}));

// Mock rebalanceHistoryService to bypass PostgreSQL connection
vi.mock('../../services/serviceContainer.js', () => ({
  rebalanceHistoryService: {
    recordRebalanceEvent: vi.fn().mockResolvedValue({ id: 'hist-1' }),
  },
}));

const mockGetPortfolio = vi.fn();
const mockExecuteRebalance = vi.fn();

vi.mock('../../services/stellar.js', () => {
  function StellarService(this: any) {}
  StellarService.prototype.getPortfolio = (...args: any[]) => mockGetPortfolio(...args);
  StellarService.prototype.checkRebalanceNeeded = vi.fn().mockResolvedValue(true);
  StellarService.prototype.executeRebalance = (...args: any[]) => mockExecuteRebalance(...args);
  return { StellarService };
});

vi.mock('../../queue/workers/workerRuntime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../queue/workers/workerRuntime.js')>();
  return {
    ...actual,
    acquireWorkerLock: vi.fn().mockResolvedValue(true),
    releaseWorkerLock: vi.fn().mockResolvedValue(true),
  };
});

import { getRebalanceQueue, getDLQQueue, closeAllQueues } from '../../queue/queues.js';
import { startRebalanceWorker, stopRebalanceWorker } from '../../queue/workers/rebalanceWorker.js';

describe('Rebalance Job Queue – Integration Tests', () => {
  let redisServer: RedisMemoryServer;
  let queue: any;
  let dlq: any;
  let worker: any;

  beforeAll(async () => {
    // Start in-memory Redis server
    redisServer = await RedisMemoryServer.create();
    const host = await redisServer.getHost();
    const port = await redisServer.getPort();
    process.env.REDIS_URL = `redis://${host}:${port}`;
  }, 30000); // 30s timeout for redis-memory-server startup

  afterAll(async () => {
    // Stop in-memory Redis server
    await redisServer.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clear the in-memory Redis database before each test
    const cleanClient = new IORedis(process.env.REDIS_URL!);
    await cleanClient.flushall();
    await cleanClient.quit();

    // Initialize queues and worker
    queue = getRebalanceQueue();
    dlq = getDLQQueue();
    worker = startRebalanceWorker();

    expect(queue).not.toBeNull();
    expect(dlq).not.toBeNull();
    expect(worker).not.toBeNull();
  });

  afterEach(async () => {
    // Gracefully shutdown workers and queues to ensure isolation
    await stopRebalanceWorker();
    await closeAllQueues();
  });

  async function waitForJobCompletion(jobId: string, retryCount = 100) {
    for (let i = 0; i < retryCount; i++) {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'completed' || state === 'failed') {
          return job;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Job ${jobId} did not finish within timeout`);
  }

  async function waitForDLQJobs(retryCount = 100) {
    for (let i = 0; i < retryCount; i++) {
      const jobs = await dlq.getJobs(['waiting', 'active', 'completed', 'failed']);
      if (jobs.length > 0) {
        return jobs;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No jobs appeared in the DLQ within timeout`);
  }

  it('should process a rebalance job successfully end-to-end', async () => {
    mockGetPortfolio.mockResolvedValue({
      id: 'portfolio-ok',
      userAddress: 'GA1234SUCCESS',
      allocations: { XLM: 50, USDC: 50 },
    });

    mockExecuteRebalance.mockResolvedValue({
      trades: 2,
      gasUsed: '0.02 XLM',
    });

    const job = await queue.add(
      'rebalance',
      { portfolioId: 'portfolio-ok', triggeredBy: 'auto' },
      { attempts: 1 }
    );

    expect(job).toBeDefined();
    expect(job.id).toBeDefined();

    const finishedJob = await waitForJobCompletion(job.id);
    expect(await finishedJob.getState()).toBe('completed');
    expect(mockGetPortfolio).toHaveBeenCalledWith('portfolio-ok');
    expect(mockExecuteRebalance).toHaveBeenCalledWith('portfolio-ok');
  }, 15000);

  it('should retry the job when a Stellar RPC error occurs', async () => {
    mockGetPortfolio.mockResolvedValue({
      id: 'portfolio-retry',
      userAddress: 'GA1234RETRY',
      allocations: { XLM: 50, USDC: 50 },
    });

    // Simulate transient Stellar service error
    mockExecuteRebalance.mockRejectedValue(new Error('Stellar RPC Error: Node rate limited'));

    const job = await queue.add(
      'rebalance',
      { portfolioId: 'portfolio-retry', triggeredBy: 'auto' },
      {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 100, // Short delay for quick test execution
        },
      }
    );

    const finishedJob = await waitForJobCompletion(job.id);
    expect(await finishedJob.getState()).toBe('failed');
    
    // It should have run all 3 attempts
    expect(finishedJob.attemptsMade).toBe(3);
    expect(mockExecuteRebalance).toHaveBeenCalledTimes(3);
  }, 15000);

  it('should move the job to the Dead-Letter Queue (DLQ) after maximum retries are exhausted', async () => {
    mockGetPortfolio.mockResolvedValue({
      id: 'portfolio-dlq',
      userAddress: 'GA1234DLQ',
      allocations: { XLM: 50, USDC: 50 },
    });

    mockExecuteRebalance.mockRejectedValue(new Error('Stellar RPC Error: Terminal connection failure'));

    const job = await queue.add(
      'rebalance',
      { portfolioId: 'portfolio-dlq', triggeredBy: 'auto' },
      {
        attempts: 2, // Fail after 2 attempts
        backoff: {
          type: 'fixed',
          delay: 100,
        },
      }
    );

    const finishedJob = await waitForJobCompletion(job.id);
    expect(await finishedJob.getState()).toBe('failed');
    expect(finishedJob.attemptsMade).toBe(2);

    // Wait for the job to be moved to the Dead-Letter Queue
    const dlqJobs = await waitForDLQJobs();
    expect(dlqJobs.length).toBe(1);

    const dlqJob = dlqJobs[0];
    expect(dlqJob.data.originalQueue).toBe(queue.name);
    expect(dlqJob.data.originalJobId).toBe(job.id);
    expect(dlqJob.data.attempts).toBe(2);
    expect(dlqJob.data.error).toContain('Terminal connection failure');
  }, 15000);
});
