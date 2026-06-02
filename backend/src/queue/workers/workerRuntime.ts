import { Job } from "bullmq";
import { persistWorkerStatus } from './workerHeartbeat.js';
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
 *  Returns true when the lock is successfully obtained; otherwise false.
 */
export async function acquireWorkerLock(name: string): Promise<boolean> {
    const key = stringHash32(name)
    try {
        const res = await query('SELECT pg_try_advisory_lock($1) AS locked', [key])
        // pg returns a column named "locked" with a boolean value
        return (res.rows[0] as any).locked === true
    } catch (err) {
        // If the DB is not configured or the query fails, treat as lock unavailable
        console.error('[LOCK] Failed to acquire advisory lock', { name, err })
        return false
    }
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
    const maxAttempts = job.opts.attempts || 5;
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
        originalJobId: job.id,
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
