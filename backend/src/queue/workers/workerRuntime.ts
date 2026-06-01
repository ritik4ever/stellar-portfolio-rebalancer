import { Job } from "bullmq";
import { persistWorkerStatus } from './workerHeartbeat.js';
import { getDLQQueue, DLQJobData } from '../queues.js';
import { logger } from '../../utils/logger.js';

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
