import type { Request, Response, NextFunction } from 'express'
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'
import { observabilityConfig } from './config.js'
import { getQueueMetrics } from '../queue/queueMetrics.js'
import { buildReadinessReport } from '../monitoring/readiness.js'

const register = new Registry()

register.setDefaultLabels({
    service: observabilityConfig.metrics.serviceName,
    environment: observabilityConfig.metrics.deploymentEnv,
    alert_contact: observabilityConfig.metrics.alertContact,
})

collectDefaultMetrics({
    register,
    prefix: observabilityConfig.metrics.prefix,
})

const httpRequestDuration = new Histogram({
    name: `${observabilityConfig.metrics.prefix}http_request_duration_seconds`,
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
})

const httpRequestsTotal = new Counter({
    name: `${observabilityConfig.metrics.prefix}http_requests_total`,
    help: 'Total HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [register],
})

const httpRequestsInFlight = new Gauge({
    name: `${observabilityConfig.metrics.prefix}http_requests_in_flight`,
    help: 'Active HTTP requests currently being processed',
    registers: [register],
})

const readinessGauge = new Gauge({
    name: `${observabilityConfig.metrics.prefix}readiness_status`,
    help: 'Application readiness status, 1 when ready and 0 when not ready',
    registers: [register],
})

const queueDepthGauge = new Gauge({
    name: `${observabilityConfig.metrics.prefix}queue_jobs`,
    help: 'Current queue depth by state',
    labelNames: ['queue', 'state'] as const,
    registers: [register],
})

const routeLabel = (req: Request): string => req.route?.path || req.path || 'unknown'

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!observabilityConfig.metrics.enabled) {
        next()
        return
    }

    httpRequestsInFlight.inc()
    const start = process.hrtime.bigint()

    res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000
        const labels = {
            method: req.method,
            route: routeLabel(req),
            status_code: String(res.statusCode),
        }

        httpRequestsTotal.inc(labels, 1)
        httpRequestDuration.observe(labels, durationSeconds)
        httpRequestsInFlight.dec()
    })

    next()
}

export async function getMetricsPayload(): Promise<string> {
    if (!observabilityConfig.metrics.enabled) {
        return '# metrics disabled\n'
    }

    const readiness = await buildReadinessReport()
    readinessGauge.set(readiness.status === 'ready' ? 1 : 0)

    const queueMetrics = await getQueueMetrics()
    for (const [queue, stats] of Object.entries(queueMetrics.queues)) {
        queueDepthGauge.set({ queue, state: 'waiting' }, stats.waiting)
        queueDepthGauge.set({ queue, state: 'active' }, stats.active)
        queueDepthGauge.set({ queue, state: 'completed' }, stats.completed)
        queueDepthGauge.set({ queue, state: 'failed' }, stats.failed)
        queueDepthGauge.set({ queue, state: 'delayed' }, stats.delayed)
    }

    return register.metrics()
}

export function getMetricsContentType(): string {
    return register.contentType
}
