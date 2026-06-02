#!/usr/bin/env node

/**
 * Queue Health Check Script
 *
 * This script monitors the health of BullMQ queues by checking:
 * - Queue depth (backlog size)
 * - Worker lag ratio
 * - Failure rates
 * - Drain behavior
 *
 * Exit codes:
 *   0 = All checks passed (green status)
 *   1 = Warning condition detected (yellow status)
 *   2 = Critical condition detected (red status)
 *   3 = Error connecting to backend
 *
 * Usage:
 *   node scripts/queue-health-check.mjs
 *   node scripts/queue-health-check.mjs --timeout 30000
 *   node scripts/queue-health-check.mjs --verbose
 */

import https from 'https';
import http from 'http';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const METRICS_ENDPOINT = '/metrics';
const TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT || '10000');
const VERBOSE = process.argv.includes('--verbose');

// Thresholds for queue health
const THRESHOLDS = {
  CRITICAL_BACKLOG: parseInt(process.env.QUEUE_CRITICAL_BACKLOG || '100'),
  WARNING_BACKLOG: parseInt(process.env.QUEUE_WARNING_BACKLOG || '50'),
  CRITICAL_WORKER_LAG: parseFloat(process.env.QUEUE_CRITICAL_LAG || '10'),
  WARNING_WORKER_LAG: parseFloat(process.env.QUEUE_WARNING_LAG || '5'),
  CRITICAL_FAILURE_RATE: parseFloat(process.env.QUEUE_CRITICAL_FAILURE || '0.3'), // 30%
  WARNING_FAILURE_RATE: parseFloat(process.env.QUEUE_WARNING_FAILURE || '0.1'), // 10%
};

interface QueueMetrics {
  queue: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  workerLag: number;
  drainRate: number;
  failureRate: number;
  backlog: number;
}

interface HealthCheckResult {
  status: 'healthy' | 'warning' | 'critical' | 'error';
  code: 0 | 1 | 2 | 3;
  timestamp: string;
  checksDuration: number;
  message: string;
  queues: {
    [queue: string]: {
      metrics: QueueMetrics;
      issues: string[];
    };
  };
  summary: {
    totalQueues: number;
    healthyQueues: number;
    warningQueues: number;
    criticalQueues: number;
  };
}

async function fetchMetrics(): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(METRICS_ENDPOINT, BACKEND_URL);
    const client = url.protocol === 'https:' ? https : http;

    const request = client.get(url, { timeout: TIMEOUT }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Request timeout after ${TIMEOUT}ms`));
    });
  });
}

function parsePrometheusMetrics(metricsText: string): Map<string, QueueMetrics> {
  const queues = new Map<string, QueueMetrics>();

  const lines = metricsText.split('\n');
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;

    // Parse lines like: stellar_portfolio_queue_jobs{queue="portfolio-check",state="waiting"} 5
    const match = line.match(
      /stellar_portfolio_queue_jobs\{queue="([^"]+)",state="([^"]+)"\}\s+([\d.]+)/
    );
    if (match) {
      const [, queue, state, value] = match;
      const numValue = parseInt(value);

      if (!queues.has(queue)) {
        queues.set(queue, {
          queue,
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          workerLag: 0,
          drainRate: 0,
          failureRate: 0,
          backlog: 0,
        });
      }

      const metrics = queues.get(queue)!;
      switch (state) {
        case 'waiting':
          metrics.waiting = numValue;
          break;
        case 'active':
          metrics.active = numValue;
          break;
        case 'completed':
          metrics.completed = numValue;
          break;
        case 'failed':
          metrics.failed = numValue;
          break;
        case 'delayed':
          metrics.delayed = numValue;
          break;
      }
    }

    // Parse worker lag: stellar_portfolio_queue_worker_lag{queue="portfolio-check"} 2.5
    const lagMatch = line.match(
      /stellar_portfolio_queue_worker_lag\{queue="([^"]+)"\}\s+([\d.]+)/
    );
    if (lagMatch) {
      const [, queue, value] = lagMatch;
      const metrics = queues.get(queue);
      if (metrics) {
        metrics.workerLag = parseFloat(value);
      }
    }

    // Parse drain rate: stellar_portfolio_queue_drain_rate{queue="portfolio-check"} 0.95
    const drainMatch = line.match(
      /stellar_portfolio_queue_drain_rate\{queue="([^"]+)"\}\s+([\d.]+)/
    );
    if (drainMatch) {
      const [, queue, value] = drainMatch;
      const metrics = queues.get(queue);
      if (metrics) {
        metrics.drainRate = parseFloat(value);
      }
    }

    // Parse failure rate: stellar_portfolio_queue_failure_rate{queue="portfolio-check"} 0.05
    const failureMatch = line.match(
      /stellar_portfolio_queue_failure_rate\{queue="([^"]+)"\}\s+([\d.]+)/
    );
    if (failureMatch) {
      const [, queue, value] = failureMatch;
      const metrics = queues.get(queue);
      if (metrics) {
        metrics.failureRate = parseFloat(value);
      }
    }
  }

  // Calculate derived metrics
  for (const metrics of queues.values()) {
    metrics.backlog = metrics.waiting + metrics.delayed + metrics.failed;
  }

  return queues;
}

function evaluateQueueHealth(
  queue: string,
  metrics: QueueMetrics
): {
  health: 'healthy' | 'warning' | 'critical';
  issues: string[];
} {
  const issues: string[] = [];
  let health: 'healthy' | 'warning' | 'critical' = 'healthy';

  // Check backlog
  if (metrics.backlog >= THRESHOLDS.CRITICAL_BACKLOG) {
    issues.push(
      `Critical backlog: ${metrics.backlog} jobs (threshold: ${THRESHOLDS.CRITICAL_BACKLOG})`
    );
    health = 'critical';
  } else if (metrics.backlog >= THRESHOLDS.WARNING_BACKLOG) {
    issues.push(
      `High backlog: ${metrics.backlog} jobs (threshold: ${THRESHOLDS.WARNING_BACKLOG})`
    );
    if (health !== 'critical') health = 'warning';
  }

  // Check worker lag
  if (metrics.workerLag >= THRESHOLDS.CRITICAL_WORKER_LAG) {
    issues.push(
      `Critical worker lag: ${metrics.workerLag.toFixed(2)} (threshold: ${THRESHOLDS.CRITICAL_WORKER_LAG})`
    );
    health = 'critical';
  } else if (metrics.workerLag >= THRESHOLDS.WARNING_WORKER_LAG) {
    issues.push(
      `High worker lag: ${metrics.workerLag.toFixed(2)} (threshold: ${THRESHOLDS.WARNING_WORKER_LAG})`
    );
    if (health !== 'critical') health = 'warning';
  }

  // Check failure rate
  if (metrics.failureRate >= THRESHOLDS.CRITICAL_FAILURE_RATE) {
    issues.push(
      `Critical failure rate: ${(metrics.failureRate * 100).toFixed(1)}% (threshold: ${(THRESHOLDS.CRITICAL_FAILURE_RATE * 100).toFixed(0)}%)`
    );
    health = 'critical';
  } else if (metrics.failureRate >= THRESHOLDS.WARNING_FAILURE_RATE) {
    issues.push(
      `High failure rate: ${(metrics.failureRate * 100).toFixed(1)}% (threshold: ${(THRESHOLDS.WARNING_FAILURE_RATE * 100).toFixed(0)}%)`
    );
    if (health !== 'critical') health = 'warning';
  }

  // Check for no active workers
  if (metrics.active === 0 && metrics.waiting > 0) {
    issues.push(`No active workers but ${metrics.waiting} jobs waiting`);
    if (health !== 'critical') health = 'warning';
  }

  return { health, issues };
}

async function runHealthCheck(): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    if (VERBOSE) {
      console.log(`[${new Date().toISOString()}] Fetching metrics from ${BACKEND_URL}${METRICS_ENDPOINT}`);
    }

    const metricsText = await fetchMetrics();
    const queues = parsePrometheusMetrics(metricsText);

    const result: HealthCheckResult = {
      status: 'healthy',
      code: 0,
      timestamp: new Date().toISOString(),
      checksDuration: Date.now() - startTime,
      message: 'All queues healthy',
      queues: {},
      summary: {
        totalQueues: queues.size,
        healthyQueues: 0,
        warningQueues: 0,
        criticalQueues: 0,
      },
    };

    for (const [queueName, metrics] of queues) {
      const { health, issues } = evaluateQueueHealth(queueName, metrics);

      result.queues[queueName] = {
        metrics,
        issues,
      };

      if (health === 'healthy') {
        result.summary.healthyQueues++;
      } else if (health === 'warning') {
        result.summary.warningQueues++;
        if (result.status === 'healthy') {
          result.status = 'warning';
          result.code = 1;
          result.message = 'Some queues have warnings';
        }
      } else if (health === 'critical') {
        result.summary.criticalQueues++;
        result.status = 'critical';
        result.code = 2;
        result.message = 'Critical issues detected';
      }
    }

    return result;
  } catch (error) {
    const checksDuration = Date.now() - startTime;
    return {
      status: 'error',
      code: 3,
      timestamp: new Date().toISOString(),
      checksDuration,
      message: `Failed to check queue health: ${error instanceof Error ? error.message : String(error)}`,
      queues: {},
      summary: {
        totalQueues: 0,
        healthyQueues: 0,
        warningQueues: 0,
        criticalQueues: 0,
      },
    };
  }
}

function formatOutput(result: HealthCheckResult): void {
  const statusEmoji = {
    healthy: '✓',
    warning: '⚠',
    critical: '✗',
    error: '⚠',
  };

  const statusColor = {
    healthy: '\x1b[32m', // green
    warning: '\x1b[33m', // yellow
    critical: '\x1b[31m', // red
    error: '\x1b[31m', // red
  };

  const reset = '\x1b[0m';

  console.log(
    `\n${statusColor[result.status]}${statusEmoji[result.status]} Queue Health Check Report${reset}`
  );
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Duration: ${result.checksDuration}ms`);
  console.log(`Status: ${statusColor[result.status]}${result.status.toUpperCase()}${reset}`);
  console.log(`Message: ${result.message}\n`);

  if (result.status !== 'error') {
    console.log('Summary:');
    console.log(`  Total Queues: ${result.summary.totalQueues}`);
    console.log(
      `  ${statusColor.healthy}✓ Healthy: ${result.summary.healthyQueues}${reset}`
    );
    if (result.summary.warningQueues > 0) {
      console.log(
        `  ${statusColor.warning}⚠ Warnings: ${result.summary.warningQueues}${reset}`
      );
    }
    if (result.summary.criticalQueues > 0) {
      console.log(
        `  ${statusColor.critical}✗ Critical: ${result.summary.criticalQueues}${reset}`
      );
    }

    console.log('\nQueue Details:');
    for (const [queueName, data] of Object.entries(result.queues)) {
      const { metrics, issues } = data;
      const queueHealth =
        issues.length === 0
          ? `${statusColor.healthy}healthy${reset}`
          : issues.some((i) =>
              Object.values(result.queues)
                .find((q) => q === data)
                ?.issues.some(
                  (issue) =>
                    issue.includes('Critical') || issue.includes('no active')
                )
            )
            ? `${statusColor.critical}critical${reset}`
            : `${statusColor.warning}warning${reset}`;

      console.log(`\n  ${queueName}: ${queueHealth}`);
      console.log(`    Metrics:`);
      console.log(`      Waiting: ${metrics.waiting}`);
      console.log(`      Active: ${metrics.active}`);
      console.log(`      Delayed: ${metrics.delayed}`);
      console.log(`      Failed: ${metrics.failed}`);
      console.log(`      Completed: ${metrics.completed}`);
      console.log(`      Backlog: ${metrics.backlog}`);
      console.log(`      Worker Lag: ${metrics.workerLag.toFixed(2)}`);
      console.log(`      Drain Rate: ${(metrics.drainRate * 100).toFixed(1)}%`);
      console.log(`      Failure Rate: ${(metrics.failureRate * 100).toFixed(1)}%`);

      if (issues.length > 0) {
        console.log(`    Issues:`);
        for (const issue of issues) {
          console.log(`      - ${issue}`);
        }
      }
    }
  }

  console.log(
    `\n${statusColor[result.status]}Exit code: ${result.code}${reset}\n`
  );
}

async function main(): Promise<void> {
  const result = await runHealthCheck();
  formatOutput(result);
  process.exit(result.code);
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(3);
});
