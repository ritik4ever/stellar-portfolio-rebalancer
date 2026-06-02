import type { Request, Response, NextFunction } from "express";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { observabilityConfig } from "./config.js";
import {
  getQueueMetrics,
  getWorkerHealthSummary,
} from "../queue/queueMetrics.js";
import { buildReadinessReport } from "../monitoring/readiness.js";

const register = new Registry();

register.setDefaultLabels({
  service: observabilityConfig.metrics.serviceName,
  environment: observabilityConfig.metrics.deploymentEnv,
  alert_contact: observabilityConfig.metrics.alertContact,
});

collectDefaultMetrics({
  register,
  prefix: observabilityConfig.metrics.prefix,
});

const httpRequestDuration = new Histogram({
  name: `${observabilityConfig.metrics.prefix}http_request_duration_seconds`,
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new Counter({
  name: `${observabilityConfig.metrics.prefix}http_requests_total`,
  help: "Total HTTP requests processed",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register],
});

const httpRequestsInFlight = new Gauge({
  name: `${observabilityConfig.metrics.prefix}http_requests_in_flight`,
  help: "Active HTTP requests currently being processed",
  registers: [register],
});

const readinessGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}readiness_status`,
  help: "Application readiness status, 1 when ready and 0 when not ready",
  registers: [register],
});

const queueDepthGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}queue_jobs`,
  help: "Current queue depth by state",
  labelNames: ["queue", "state"] as const,
  registers: [register],
});

const queueWorkerLagGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}queue_worker_lag`,
  help: "Worker lag ratio: (waiting + delayed) / (active + 1) per queue",
  labelNames: ["queue"] as const,
  registers: [register],
});

const priceFeedResolutionsTotal = new Counter({
  name: `${observabilityConfig.metrics.prefix}price_feed_resolutions_total`,
  help: "Total price feed resolutions by final quality classification",
  labelNames: ["resolution_hint", "degraded", "stale_or_limited"] as const,
  registers: [register],
});

const reflectorStalePricesTotal = new Counter({
  name: `${observabilityConfig.metrics.prefix}reflector_stale_prices_total`,
  help: "Total stale Reflector price rows observed by asset",
  labelNames: ["asset"] as const,
  registers: [register],
});

const reflectorFallbackUsageTotal = new Counter({
  name: `${observabilityConfig.metrics.prefix}reflector_fallback_usage_total`,
  help: "Total fallback price resolutions used by the backend",
  labelNames: ["reason"] as const,
  registers: [register],
});

// TTL and cache metrics
const cacheHitRatioGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}cache_hit_ratio`,
  help: "Cache hit ratio by asset (0.0 to 1.0)",
  labelNames: ["asset"] as const,
  registers: [register],
});

const cacheAgeHistogram = new Histogram({
  name: `${observabilityConfig.metrics.prefix}cache_age_milliseconds`,
  help: "Age of cached price entries in milliseconds",
  labelNames: ["asset"] as const,
  buckets: [100, 500, 1000, 5000, 10000, 30000, 60000, 300000, 600000],
  registers: [register],
});

const cacheSizeGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}cache_size_bytes`,
  help: "Approximate size of price cache in bytes",
  registers: [register],
});

const cacheEntriesGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}cache_entries_total`,
  help: "Total number of entries in price cache",
  registers: [register],
});

const cacheOperationsTotal = new Counter({
  name: `${observabilityConfig.metrics.prefix}cache_operations_total`,
  help: "Cache operations (hit, miss, eviction, update)",
  labelNames: ["operation", "asset"] as const,
  registers: [register],
});

const cacheTtlSecondsGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}cache_ttl_seconds`,
  help: "Current TTL configuration for price cache in seconds",
  registers: [register],
});

const cacheExpirationCounterTotal = new Counter({
  name: `${observabilityConfig.metrics.prefix}cache_expirations_total`,
  help: "Total number of cache entries that expired",
  labelNames: ["asset"] as const,
  registers: [register],
});

const queueDrainRateGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}queue_drain_rate`,
  help: "Rate of job completion (completed jobs)",
  labelNames: ["queue"] as const,
  registers: [register],
});

const queueFailureRateGauge = new Gauge({
  name: `${observabilityConfig.metrics.prefix}queue_failure_rate`,
  help: "Failure rate: failed / (completed + failed)",
  labelNames: ["queue"] as const,
  registers: [register],
});

const workerHealthTotal = new Gauge({
  name: `${observabilityConfig.metrics.prefix}worker_health_total`,
  help: "Total number of workers",
  registers: [register],
});

const workerHealthyTotal = new Gauge({
  name: `${observabilityConfig.metrics.prefix}worker_healthy_total`,
  help: "Number of healthy workers",
  registers: [register],
});

const workerUnhealthyTotal = new Gauge({
  name: `${observabilityConfig.metrics.prefix}worker_unhealthy_total`,
  help: "Number of unhealthy workers",
  registers: [register],
});

const workerIdleTotal = new Gauge({
  name: `${observabilityConfig.metrics.prefix}worker_idle_total`,
  help: "Number of idle workers",
  registers: [register],
});

const workerLaggingTotal = new Gauge({
  name: `${observabilityConfig.metrics.prefix}worker_lagging_total`,
  help: "Number of workers with high lag",
  registers: [register],
});

const workerStatus = new Gauge({
  name: `${observabilityConfig.metrics.prefix}worker_status`,
  help: "Per-worker status (1 = ready, 0 = not ready)",
  labelNames: ["worker_name"] as const,
  registers: [register],
});

const routeLabel = (req: Request): string =>
  req.route?.path || req.path || "unknown";

export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!observabilityConfig.metrics.enabled) {
    next();
    return;
  }

  httpRequestsInFlight.inc();
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationSeconds =
      Number(process.hrtime.bigint() - start) / 1_000_000_000;
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels, 1);
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsInFlight.dec();
  });

  next();
};

export async function getMetricsPayload(): Promise<string> {
  if (!observabilityConfig.metrics.enabled) {
    return "# metrics disabled\n";
  }

  const readiness = await buildReadinessReport();
  readinessGauge.set(readiness.status === "ready" ? 1 : 0);

  const queueMetrics = await getQueueMetrics();
  for (const [queue, stats] of Object.entries(queueMetrics.queues)) {
    queueDepthGauge.set({ queue, state: "waiting" }, stats.waiting);
    queueDepthGauge.set({ queue, state: "active" }, stats.active);
    queueDepthGauge.set({ queue, state: "completed" }, stats.completed);
    queueDepthGauge.set({ queue, state: "failed" }, stats.failed);
    queueDepthGauge.set({ queue, state: "delayed" }, stats.delayed);

    // Calculate worker lag ratio: (waiting + delayed) / (active + 1)
    // The +1 prevents division by zero and represents a single worker minimum
    const backlog = stats.waiting + stats.delayed;
    const workerCount = Math.max(stats.active, 1);
    const workerLag = backlog / workerCount;
    queueWorkerLagGauge.set({ queue }, workerLag);

    // Calculate drain rate (ratio of completed jobs to total processed)
    const totalProcessed = stats.completed + stats.failed;
    const drainRate = totalProcessed > 0 ? stats.completed / totalProcessed : 0;
    queueDrainRateGauge.set({ queue }, drainRate);

    // Calculate failure rate
    const failureRate = totalProcessed > 0 ? stats.failed / totalProcessed : 0;
    queueFailureRateGauge.set({ queue }, failureRate);
  }

  // Update worker health metrics
  const workerHealth = await getWorkerHealthSummary();
  workerHealthTotal.set(workerHealth.total);
  workerHealthyTotal.set(workerHealth.healthy);
  workerUnhealthyTotal.set(workerHealth.unhealthy);
  workerIdleTotal.set(workerHealth.idle);
  workerLaggingTotal.set(workerHealth.lagging);

  // Update per-worker status
  for (const worker of workerHealth.workers) {
    workerStatus.set({ worker_name: worker.name }, worker.ready ? 1 : 0);
  }

  return register.metrics();
}

export function getMetricsContentType(): string {
  return register.contentType;
}

export function recordPriceFeedResolution(
  meta: Pick<
    { resolutionHint: string; degraded: boolean; staleOrLimited: boolean },
    "resolutionHint" | "degraded" | "staleOrLimited"
  >,
): void {
  priceFeedResolutionsTotal.inc({
    resolution_hint: meta.resolutionHint,
    degraded: String(meta.degraded),
    stale_or_limited: String(meta.staleOrLimited),
  });
}

export function recordReflectorStalePrice(asset: string): void {
  reflectorStalePricesTotal.inc({ asset });
}

export function recordReflectorFallbackUsage(reason: string): void {
  reflectorFallbackUsageTotal.inc({ reason });
}

// Cache metrics recording functions
export function recordCacheHitRatio(asset: string, ratio: number): void {
  cacheHitRatioGauge.set({ asset }, Math.max(0, Math.min(1, ratio)));
}

export function recordCacheAge(asset: string, ageMs: number): void {
  cacheAgeHistogram.observe({ asset }, ageMs);
}

export function recordCacheSize(sizeBytes: number): void {
  cacheSizeGauge.set(sizeBytes);
}

export function recordCacheEntries(count: number): void {
  cacheEntriesGauge.set(count);
}

export function recordCacheOperation(operation: "hit" | "miss" | "eviction" | "update", asset: string): void {
  cacheOperationsTotal.inc({ operation, asset });
}

export function recordCacheTtl(ttlSeconds: number): void {
  cacheTtlSecondsGauge.set(ttlSeconds);
}

export function recordCacheExpiration(asset: string): void {
  cacheExpirationCounterTotal.inc({ asset });
}
