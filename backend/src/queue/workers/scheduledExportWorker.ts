/**
 * scheduledExportWorker.ts
 * Weekly sweep that emails a CSV export to every user with an active schedule (#1411).
 *
 * The job is a sweep rather than one job per user: schedules carry their own
 * `next_run_at` cursor, so a missed tick is caught up on the following run and a
 * single repeatable job is enough regardless of how many users opt in.
 */

import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import {
    QUEUE_NAMES,
    type ScheduledExportJobData,
    type ScheduledExportJobResult,
} from '../queues.js'
import { logger } from '../../utils/logger.js'
import { runDueExportSchedules } from '../../services/portfolioExportService.js'
import {
    createWorkerRuntimeStatus,
    setSchedulerRegistered,
    markWorkerStarting,
    markWorkerReady,
    markWorkerJobCompleted,
    markWorkerJobFailed,
    markWorkerStopped,
    markWorkerFailed,
    snapshotWorkerRuntimeStatus,
    type WorkerRuntimeStatus,
} from './workerRuntime.js'

export const scheduledExportRuntimeStatus = createWorkerRuntimeStatus('scheduled-export', 1)

let worker: Worker<ScheduledExportJobData, ScheduledExportJobResult> | null = null

export function setScheduledExportSchedulerRegistered(registered: boolean): void {
    setSchedulerRegistered(scheduledExportRuntimeStatus, registered)
}

export async function processScheduledExportJob(
    job: Job<ScheduledExportJobData, ScheduledExportJobResult>,
): Promise<ScheduledExportJobResult> {
    logger.info('[WORKER:scheduled-export] Running due export schedules', {
        jobId: job.id,
        triggeredBy: job.data?.triggeredBy,
        correlationId: job.data?.correlationId,
    })

    const results = await runDueExportSchedules(job.data?.asOf)

    const summary: ScheduledExportJobResult = {
        processed: results.length,
        sent: results.filter((r) => r.status === 'sent').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
    }

    logger.info('[WORKER:scheduled-export] Sweep complete', { jobId: job.id, ...summary })

    return summary
}

export function startScheduledExportWorker(): Worker<ScheduledExportJobData, ScheduledExportJobResult> | null {
    if (worker) return worker

    try {
        markWorkerStarting(scheduledExportRuntimeStatus)
        worker = new Worker<ScheduledExportJobData, ScheduledExportJobResult>(
            QUEUE_NAMES.SCHEDULED_EXPORT,
            processScheduledExportJob,
            {
                connection: getConnectionOptions(),
                concurrency: scheduledExportRuntimeStatus.concurrency,
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 200 },
            },
        )
    } catch (err) {
        markWorkerFailed(scheduledExportRuntimeStatus, err)
        logger.warn('[WORKER:scheduled-export] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

    worker.on('ready', () => {
        markWorkerReady(scheduledExportRuntimeStatus)
        logger.info(`[WORKER:scheduled-export] Worker ready on queue: ${QUEUE_NAMES.SCHEDULED_EXPORT}`)
    })

    worker.on('completed', () => {
        markWorkerJobCompleted(scheduledExportRuntimeStatus)
    })

    worker.on('failed', (j: Job | undefined, err: Error) => {
        logger.error('[WORKER:scheduled-export] Job failed', {
            jobId: j?.id,
            error: err.message,
            attemptsMade: j?.attemptsMade,
        })
        markWorkerJobFailed(scheduledExportRuntimeStatus, err)
    })

    return worker
}

export async function stopScheduledExportWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        markWorkerStopped(scheduledExportRuntimeStatus)
        logger.info('[WORKER:scheduled-export] Worker stopped')
    }
}

export function isScheduledExportWorkerRunning(): boolean {
    return worker !== null
}

export function getScheduledExportWorkerStatus(): WorkerRuntimeStatus {
    return snapshotWorkerRuntimeStatus(scheduledExportRuntimeStatus)
}
