import type { Job } from 'bullmq'
import { Worker } from 'bullmq'
import { logger } from '../../utils/logger.js'
import { getPortfolioExport } from '../../services/portfolioExportService.js'
import { getConnectionOptions } from '../connection.js'
import type { PortfolioExportJobData, PortfolioExportResult } from '../queues.js'
import {
    createWorkerRuntimeStatus,
    markWorkerFailed,
    markWorkerJobCompleted,
    markWorkerJobFailed,
    markWorkerReady,
    markWorkerStarting,
    markWorkerStopped,
    snapshotWorkerRuntimeStatus,
    type WorkerRuntimeStatus,
} from './workerRuntime.js'

let worker: Worker<PortfolioExportJobData, PortfolioExportResult> | null = null
const runtimeStatus = createWorkerRuntimeStatus('portfolio-export', 2)

export async function processPortfolioExportJob(
    job: Job<PortfolioExportJobData, PortfolioExportResult>
): Promise<PortfolioExportResult> {
    const { portfolioId, format, userId } = job.data

    logger.info('[WORKER:portfolio-export] Processing export job', {
        jobId: job.id,
        portfolioId,
        format,
        userId
    })

    const result = await getPortfolioExport(portfolioId, format)
    if (!result) {
        throw new Error(`Export failed: portfolio ${portfolioId} not found or no data available`)
    }

    const payload: PortfolioExportResult = {
        contentType: result.contentType,
        filename: result.filename
    }

    if (Buffer.isBuffer(result.body)) {
        payload.bodyBase64 = result.body.toString('base64')
    } else {
        payload.bodyString = result.body
    }

    return payload
}

export function startPortfolioExportWorker(): Worker<PortfolioExportJobData, PortfolioExportResult> | null {
    if (worker) return worker

    try {
        markWorkerStarting(runtimeStatus)
        worker = new Worker<PortfolioExportJobData, PortfolioExportResult>(
            'portfolio-export',
            processPortfolioExportJob,
            {
                connection: getConnectionOptions(),
                concurrency: 2,
            }
        )
    } catch (err) {
        markWorkerFailed(runtimeStatus, err)
        logger.warn('[WORKER:portfolio-export] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

    void worker.waitUntilReady().then(() => {
        markWorkerReady(runtimeStatus)
        logger.info('[WORKER:portfolio-export] Worker ready')
    }).catch((err) => {
        markWorkerFailed(runtimeStatus, err)
        logger.error('[WORKER:portfolio-export] Worker failed readiness check', {
            error: err instanceof Error ? err.message : String(err),
        })
    })

    worker.on('completed', (j: Job) => {
        logger.info('[WORKER:portfolio-export] Job completed', {
            jobId: j.id,
            portfolioId: j.data.portfolioId,
        })
        markWorkerJobCompleted(runtimeStatus)
    })

    worker.on('failed', (j: Job | undefined, err: Error) => {
        logger.error('[WORKER:portfolio-export] Job failed', {
            jobId: j?.id,
            portfolioId: j?.data.portfolioId,
            error: err.message,
            attemptsMade: j?.attemptsMade,
        })
        markWorkerJobFailed(runtimeStatus, err)
    })

    logger.info('[WORKER:portfolio-export] Worker started (concurrency=2)')
    return worker
}

export async function stopPortfolioExportWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        markWorkerStopped(runtimeStatus)
        logger.info('[WORKER:portfolio-export] Worker stopped')
    }
}

export function isPortfolioExportWorkerRunning(): boolean {
    return worker !== null
}

export function getPortfolioExportWorkerStatus(): WorkerRuntimeStatus {
    return snapshotWorkerRuntimeStatus(runtimeStatus)
}
