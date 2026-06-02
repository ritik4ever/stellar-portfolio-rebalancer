import { Queue, Job } from "bullmq";
import {
  getPortfolioCheckQueue,
  getRebalanceQueue,
  getAnalyticsSnapshotQueue,
  QUEUE_NAMES,
} from "./queues.js";
import { isRedisAvailable } from "./connection.js";
import { logger } from "../utils/logger.js";

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface AllQueueMetrics {

}

export interface FailedJobInfo {
  jobId: number | string;
  queueName: string;
  failedAt: string;
  error: string;
  attemptsMade: number;
  data: Record<string, unknown>;
}

export interface FailedJobsResult {
  totalFailed: number;
  jobs: FailedJobInfo[];
  countsByQueue: Record<string, number>;
}


}

/**
 * Returns queue depth metrics for all three queues.
 */
export async function getQueueMetrics(): Promise<AllQueueMetrics> {


  if (!redisConnected) {
    return {
      redisConnected: false,
      queues: {
        [QUEUE_NAMES.PORTFOLIO_CHECK]: EMPTY_STATS,
        [QUEUE_NAMES.REBALANCE]: EMPTY_STATS,
        [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: EMPTY_STATS,
      },
    };
  }

  const [portfolioCheckStats, rebalanceStats, analyticsStats] =
    await Promise.all([
      statsFor(getPortfolioCheckQueue()),
      statsFor(getRebalanceQueue()),
      statsFor(getAnalyticsSnapshotQueue()),
    ]);

  return {
    redisConnected: true,
    queues: {
      [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioCheckStats,
      [QUEUE_NAMES.REBALANCE]: rebalanceStats,
      [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsStats,
    },
  };
}

/**
 * Get failed jobs from all queues for inspection.
 * Limits to most recent jobs for performance.
 */
export async function getFailedJobs(
  limit: number = 20,
): Promise<FailedJobsResult> {
  const redisConnected = await isRedisAvailable();

  if (!redisConnected) {
    return {
      totalFailed: 0,
      jobs: [],
      countsByQueue: {},
    };
  }

  const queues = [
    { queue: getPortfolioCheckQueue(), name: QUEUE_NAMES.PORTFOLIO_CHECK },
    { queue: getRebalanceQueue(), name: QUEUE_NAMES.REBALANCE },
    {
      queue: getAnalyticsSnapshotQueue(),
      name: QUEUE_NAMES.ANALYTICS_SNAPSHOT,
    },
  ];

  const allFailedJobs: FailedJobInfo[] = [];
  const countsByQueue: Record<string, number> = {};

  for (const { queue, name } of queues) {
    if (!queue) continue;

    try {
      const failedJobs = await queue.getFailed(0, limit);
      countsByQueue[name] = failedJobs.length;

      for (const job of failedJobs) {
        allFailedJobs.push({
          jobId: job.id ?? "unknown",
          queueName: name,
          failedAt: job.finishedOn
            ? new Date(job.finishedOn).toISOString()
            : new Date(job.timestamp).toISOString(),
          error: job.stacktrace?.[0] ?? job.returnvalue ?? "Unknown error",
          attemptsMade: job.attemptsMade ?? 0,
          data:
            job.data !== null &&
            typeof job.data === "object" &&
            !Array.isArray(job.data)
              ? (job.data as Record<string, unknown>)
              : { value: job.data },
        });
      }
    } catch (err) {
      logger.warn("[queueMetrics] Failed to get failed jobs from queue", {
        queue: name,
        error: String(err),
      });
      countsByQueue[name] = 0;
    }
  }

  allFailedJobs.sort(
    (a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime(),
  );
  const totalFailed = Object.values(countsByQueue).reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    totalFailed,
    jobs: allFailedJobs.slice(0, limit),
    countsByQueue,
  };
}

export interface WorkerHealth {
  name: string;
  ready: boolean;
}

export interface WorkerHealthSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  idle: number;
  lagging: number;
  workers: WorkerHealth[];
}

/**
 * Get worker health summary by analyzing queue metrics.
 * Derives worker status from active jobs, failures, and queue depth.
 */
export async function getWorkerHealthSummary(): Promise<WorkerHealthSummary> {
  const redisConnected = await isRedisAvailable();

  if (!redisConnected) {
    return {
      total: 0,
      healthy: 0,
      unhealthy: 0,
      idle: 0,
      lagging: 0,
      workers: [],
    };
  }

  const metrics = await getQueueMetrics();
  const queueNames = Object.keys(metrics.queues);

  // Create one "worker" entry per queue (representing the worker processing that queue)
  const workers: WorkerHealth[] = queueNames.map((queueName) => {
    const stats = metrics.queues[queueName];
    // Consider a worker healthy if it's actively processing (active > 0) and not lagging
    const backlog = stats.waiting + stats.delayed;
    const isLagging = backlog > stats.active * 5; // Lagging if backlog > 5x active workers
    const isReady = stats.active > 0 && !isLagging;
    return {
      name: queueName,
      ready: isReady,
    };
  });

  const healthy = workers.filter((w) => w.ready).length;
  const unhealthy = workers.length - healthy;
  const idle = workers.filter(
    (w) => !w.ready && metrics.queues[w.name].active === 0,
  ).length;
  const lagging = workers.filter((w) => {
    const stats = metrics.queues[w.name];
    return stats.waiting + stats.delayed > stats.active * 5;
  }).length;

  return {
    total: workers.length,
    healthy,
    unhealthy,
    idle,
    lagging,
    workers,
  };
}
