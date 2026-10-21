import { Job, Worker } from "bullmq";
import {
    persistWorkerStatus,
    registerWorkerRestartHandler,
    clearWorkerRestartHandlers,
    startWorkerSupervisor,
    stopWorkerSupervisor,
    DEFAULT_SUPERVISOR_CONFIG,
    type SupervisorConfig,
} from './workerHeartbeat.js';
import { getDLQQueue, DLQJobData } from '../queues.js';
import { logger } from '../../utils/logger.js';
import { query } from '../../db/client.js';


export interface WorkerRuntimeStatus {
    name: string
    concurrency: number
    started: boolean
    ready: boolean
    lastStartedAt?: string
    lastReadyAt?: string
    lastStoppedAt?: string
    lastError?: string
    lastSuccessfulRunAt?: string
    lastErrorAt?: string
    schedulerRegistered: boolean
}

/**
 * Lazy accessors for the lock-instrumentation dependencies. They are imported
 * lazily (rather than at module top level) so `workerRuntime` stays light:
 * importing the lock helpers from a test must not pull in the whole worker
 * graph (portfolioStorage → better-sqlite3, Stellar SDK, …). See #1399.
 */
async function getLockInstrumentation(): Promise<{
    recordWorkerLockAcquisition: (input: {
        portfolioId: string
        outcome: 'acquired' | 'contended'
        waitMs: number
    }) => void
    getWaitWarnMs: () => number
}> {
    const [{ recordWorkerLockAcquisition }, { getRebalanceLockConfig }] = await Promise.all([
        import('../../observability/metrics.js'),
        import('../../config/rebalanceLockConfig.js'),
    ])
    return {
        recordWorkerLockAcquisition,
        getWaitWarnMs: () => getRebalanceLockConfig().waitWarnMs,
    }
}

/** Simple deterministic hash to map a string into a 32‑bit integer for advisory lock keys. */
function stringHash32(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i)
        hash |= 0 // convert to 32‑bit integer
    }
    return hash
}

/** Acquire a PostgreSQL advisory lock for the given worker name.
 * Records wait time + contention (lock-already-held) metrics labelled by a
 * bucketed portfolio identifier (#1399), and logs a warning when acquisition
 * exceeds the configurable `REBALANCE_LOCK_WAIT_WARN_MS` threshold —
 * indicating a possibly stuck lock or saturated DB pool.
 * Returns true when the lock is successfully obtained; otherwise false.
 */
export async function acquireWorkerLock(name: string): Promise<boolean> {
    const key = stringHash32(name)
    const startedAt = Date.now()
    let acquired: boolean
    try {
        const res = await query('SELECT pg_try_advisory_lock($1) AS locked', [key])
        // pg returns a column named "locked" with a boolean value
        acquired = (res.rows[0] as any).locked === true
    } catch (err) {
        // If the DB is not configured or the query fails, treat as lock unavailable
        console.error('[LOCK] Failed to acquire advisory lock', { name, err })
        acquired = false
    }
    const waitMs = Date.now() - startedAt
    const { recordWorkerLockAcquisition, getWaitWarnMs } = await getLockInstrumentation()
    recordWorkerLockAcquisition({
        portfolioId: name,
        outcome: acquired ? 'acquired' : 'contended',
        waitMs,
    })
    const waitWarnMs = getWaitWarnMs()
    if (waitMs > waitWarnMs) {
        logger.warn('[LOCK] Slow lock acquisition — possible stuck lock', {
            portfolioId: name,
            waitMs,
            waitWarnMs,
            acquired,
        })
    }
    return acquired
}

/** Release a previously acquired advisory lock for the given worker name. */
export async function releaseWorkerLock(name: string): Promise<void> {
    const key = stringHash32(name)
    try {
        await query('SELECT pg_advisory_unlock($1)', [key])
    } catch (err) {
        console.error('[LOCK] Failed to release advisory lock', { name, err })
    }
}

export function createWorkerRuntimeStatus(name: string, concurrency: number): WorkerRuntimeStatus {
    return {
        name,
        concurrency,
        started: false,
        ready: false,
        schedulerRegistered: false,
    }
}

export function markWorkerStarting(status: WorkerRuntimeStatus): void {
    status.started = true
    status.ready = false
    status.lastStartedAt = new Date().toISOString()
    status.lastError = undefined
    void persistWorkerStatus(status)
}

export function markWorkerReady(status: WorkerRuntimeStatus): void {
    status.started = true
    status.ready = true
    status.lastReadyAt = new Date().toISOString()
    status.lastError = undefined
    void persistWorkerStatus(status)
}

export function markWorkerFailed(status: WorkerRuntimeStatus, error: unknown): void {
    status.ready = false
    status.lastError = error instanceof Error ? error.message : String(error)
    void persistWorkerStatus(status)
}

export function markWorkerStopped(status: WorkerRuntimeStatus): void {
    status.started = false
    status.ready = false
    status.lastStoppedAt = new Date().toISOString()
    void persistWorkerStatus(status)
}

export function markWorkerJobCompleted(status: WorkerRuntimeStatus): void {
    status.lastSuccessfulRunAt = new Date().toISOString()
    void persistWorkerStatus(status)
}

export function markWorkerJobFailed(status: WorkerRuntimeStatus, error: unknown): void {
    status.lastErrorAt = new Date().toISOString()
    status.lastError = error instanceof Error ? error.message : String(error)
    void persistWorkerStatus(status)
}

export function setSchedulerRegistered(status: WorkerRuntimeStatus, registered: boolean): void {
    status.schedulerRegistered = registered
    void persistWorkerStatus(status)
}

export function snapshotWorkerRuntimeStatus(status: WorkerRuntimeStatus): WorkerRuntimeStatus {
    return { ...status }
}

export async function handleFinalFailure(job: Job, error: unknown): Promise<void> {
    const maxAttempts = job.opts.attempts || 3;
    if (job.attemptsMade < maxAttempts) {
        return;
    }

    logger.error(`[DLQ] Job ${job.id} exhausted all ${maxAttempts} retries. Moving to DLQ. Error: ${error instanceof Error ? error.message : String(error)}`);

    const dlq = getDLQQueue();
    if (!dlq) {
        logger.error(`[DLQ] Failed to get DLQ queue instance. Job ${job.id} cannot be dead-lettered.`);
        return;
    }

    const dlqJobData: DLQJobData = {
        originalQueue: job.queueName,
        originalJobId: job.id as string,
        attempts: job.attemptsMade,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack || "" : "",
        failedAt: new Date().toISOString(),
        payload: job.data,
    };

    try {
        await dlq.add("dead-letter", dlqJobData);
        logger.info(`[DLQ] Successfully moved job ${job.id} to dead-letter-queue.`);
    } catch (err) {
        logger.error(`[DLQ] Error occurred while adding job ${job.id} to DLQ: ${err instanceof Error ? err.message : String(err)}`);
    }
}

let workers: Worker[] = []

/** Default cadence of the heartbeat supervisor sweep (#1194). */
export const DEFAULT_WORKER_SUPERVISOR_INTERVAL_MS = 30_000

function readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/** The heartbeat supervisor is on by default; ops can opt out per environment. */
export function isWorkerSupervisorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.WORKER_SUPERVISOR_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
}

/** Supervisor tuning resolved from the environment, falling back to safe defaults. */
export function getWorkerSupervisorConfig(env: NodeJS.ProcessEnv = process.env): Partial<SupervisorConfig> {
    return {
        missedHeartbeatThreshold: readPositiveInt(
            env.WORKER_SUPERVISOR_MISSED_HEARTBEATS,
            DEFAULT_SUPERVISOR_CONFIG.missedHeartbeatThreshold,
        ),
        maxRestartAttempts: readPositiveInt(env.WORKER_SUPERVISOR_MAX_RESTARTS, DEFAULT_SUPERVISOR_CONFIG.maxRestartAttempts),
        restartWindowMs: readPositiveInt(env.WORKER_SUPERVISOR_RESTART_WINDOW_MS, DEFAULT_SUPERVISOR_CONFIG.restartWindowMs),
    }
}

/** Sweep interval (ms) for the heartbeat supervisor loop. */
export function getWorkerSupervisorIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
    return readPositiveInt(env.WORKER_SUPERVISOR_INTERVAL_MS, DEFAULT_WORKER_SUPERVISOR_INTERVAL_MS)
}

interface WorkerRestartDefinition {
    /** Worker status name, matching the key used by persistWorkerStatus */
    name: string
    /** Stops the affected worker instance and starts a fresh one */
    restart: () => Promise<void>
}

/**
 * Restart handlers for every worker started by startAllWorkers().
 * The heartbeat supervisor (#1194) invokes these instead of only logging a
 * missed heartbeat, so a crashed or hung worker is brought back within a
 * bounded number of attempts. Price-history workers are excluded because they
 * do not persist a heartbeat status entry.
 */
function buildWorkerRestartDefinitions(): WorkerRestartDefinition[] {
    return [
        {
            name: 'portfolio-check',
            restart: async () => {
                const { stopPortfolioCheckWorker, startPortfolioCheckWorker } = await import('./portfolioCheckWorker.js')
                await stopPortfolioCheckWorker()
                startPortfolioCheckWorker()
            },
        },
        {
            name: 'rebalance',
            restart: async () => {
                const { stopRebalanceWorker, startRebalanceWorker } = await import('./rebalanceWorker.js')
                await stopRebalanceWorker()
                startRebalanceWorker()
            },
        },
        {
            name: 'analytics-snapshot',
            restart: async () => {
                const { stopAnalyticsSnapshotWorker, startAnalyticsSnapshotWorker } = await import('./analyticsSnapshotWorker.js')
                await stopAnalyticsSnapshotWorker()
                startAnalyticsSnapshotWorker()
            },
        },
        {
            name: 'analytics-compaction',
            restart: async () => {
                const { stopAnalyticsCompactionWorker, startAnalyticsCompactionWorker } = await import('./analyticsCompactionWorker.js')
                await stopAnalyticsCompactionWorker()
                startAnalyticsCompactionWorker()
            },
        },
        {
            name: 'idempotency-cleanup',
            restart: async () => {
                const { stopIdempotencyCleanupWorker, startIdempotencyCleanupWorker } = await import('./idempotencyCleanupWorker.js')
                await stopIdempotencyCleanupWorker()
                startIdempotencyCleanupWorker()
            },
        },
        {
            name: 'portfolio-export',
            restart: async () => {
                const { stopPortfolioExportWorker, startPortfolioExportWorker } = await import('./portfolioExportWorker.js')
                await stopPortfolioExportWorker()
                startPortfolioExportWorker()
            },
        },
        {
            name: 'user-alerts',
            restart: async () => {
                const { stopUserAlertsWorker, startUserAlertsWorker } = await import('./userAlertsWorker.js')
                await stopUserAlertsWorker()
                startUserAlertsWorker()
            },
        },
        {
            name: 'scheduled-export',
            restart: async () => {
                const { stopScheduledExportWorker, startScheduledExportWorker } = await import('./scheduledExportWorker.js')
                await stopScheduledExportWorker()
                startScheduledExportWorker()
            },
        },
    ]
}

/** Names of the workers the heartbeat supervisor can restart. */
export function getSupervisedWorkerNames(): string[] {
    return buildWorkerRestartDefinitions().map((definition) => definition.name)
}

/**
 * Attach a stop-and-restart handler for every supervised worker so the
 * heartbeat supervisor can recover workers that stop sending heartbeats.
 */
export function registerDefaultWorkerRestartHandlers(): string[] {
    const definitions = buildWorkerRestartDefinitions()
    for (const definition of definitions) {
        registerWorkerRestartHandler(definition.name, definition.restart)
    }
    return definitions.map((definition) => definition.name)
}

export async function startAllWorkers(): Promise<void> {
    logger.info('[WORKER] Starting all background workers...')

    try {
        const [
            { startPortfolioCheckWorker },
            { startRebalanceWorker },
            { startAnalyticsSnapshotWorker },
            { startAnalyticsCompactionWorker },
            { startIdempotencyCleanupWorker },
            { startPortfolioExportWorker },
            { startUserAlertsWorker },
            { startScheduledExportWorker },
            { startPriceHistoryWorkers },
        ] = await Promise.all([
            import('./portfolioCheckWorker.js'),
            import('./rebalanceWorker.js'),
            import('./analyticsSnapshotWorker.js'),
            import('./analyticsCompactionWorker.js'),
            import('./idempotencyCleanupWorker.js'),
            import('./portfolioExportWorker.js'),
            import('./userAlertsWorker.js'),
            import('./scheduledExportWorker.js'),
            import('./priceHistoryWorker.js'),
        ])

        workers.push(
            startPortfolioCheckWorker() as Worker,
            startRebalanceWorker() as Worker,
            startAnalyticsSnapshotWorker() as Worker,
            startAnalyticsCompactionWorker() as Worker,
            startIdempotencyCleanupWorker() as Worker,
            startPortfolioExportWorker() as Worker,
            startUserAlertsWorker(),
            startScheduledExportWorker() as Worker
        )
        
        startPriceHistoryWorkers()

        // Supervised recovery (#1194): register a restart handler per worker and
        // start the heartbeat supervisor so a worker that stops sending
        // heartbeats is restarted automatically, with crash-loop protection.
        if (isWorkerSupervisorEnabled()) {
            const supervised = registerDefaultWorkerRestartHandlers()
            const config = getWorkerSupervisorConfig()
            const intervalMs = getWorkerSupervisorIntervalMs()
            startWorkerSupervisor(config, intervalMs)
            logger.info('[WORKER] Heartbeat supervisor started', {
                supervised,
                intervalMs,
                config,
            })
        } else {
            logger.warn('[WORKER] Heartbeat supervisor disabled (WORKER_SUPERVISOR_ENABLED=false)')
        }

        logger.info(`[WORKER] Successfully started ${workers.length} standard worker(s) alongside price history workers`)
    } catch (error) {
        logger.error('[WORKER] Failed to start one or more workers:', error)
        throw error
    }
}

export async function stopAllWorkers(): Promise<void> {
    logger.info('[WORKER] Stopping all background workers...')

    // Stop supervising first so shutdown is not interpreted as a missed heartbeat.
    stopWorkerSupervisor()
    clearWorkerRestartHandlers()

    try {
        const { stopPriceHistoryWorkers } = await import('./priceHistoryWorker.js')
        await Promise.all([
            ...workers.map(w => w.close()),
            stopPriceHistoryWorkers()
        ])
        workers = []
        logger.info('[WORKER] All workers stopped successfully')
    } catch (error) {
        logger.error('[WORKER] Error while stopping workers:', error)
    }
}