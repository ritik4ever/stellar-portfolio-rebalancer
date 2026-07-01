import { Worker, Job } from 'bullmq';
import { getConnectionOptions } from '../connection.js';
import { QUEUE_NAMES, UserAlertsJobData } from '../queues.js';
import { logger } from '../../utils/logger.js';
import { evaluateUserAlerts } from '../../notifications/alerts.js';
import {
    createWorkerRuntimeStatus,
    setSchedulerRegistered,
    markWorkerStarting,
    markWorkerReady,
    markWorkerJobCompleted,
    markWorkerJobFailed,
    markWorkerStopped,
    markWorkerFailed,
    handleFinalFailure
} from './workerRuntime.js';

export const userAlertsRuntimeStatus = createWorkerRuntimeStatus('user-alerts', 1);

export function setUserAlertsSchedulerRegistered(registered: boolean): void {
    setSchedulerRegistered(userAlertsRuntimeStatus, registered);
}

export function startUserAlertsWorker(): Worker {
    markWorkerStarting(userAlertsRuntimeStatus);

    const worker = new Worker<UserAlertsJobData>(
        QUEUE_NAMES.USER_ALERTS,
        async (job: Job<UserAlertsJobData>) => {
            logger.info(`[WORKER] Starting user alerts evaluation job ${job.id}`, {
                correlationId: job.data.correlationId,
                triggeredBy: job.data.triggeredBy
            });

            try {
                await evaluateUserAlerts();
                
                logger.info(`[WORKER] Successfully completed user alerts evaluation job ${job.id}`);
            } catch (error) {
                logger.error(`[WORKER] User alerts evaluation job ${job.id} failed`, {
                    error: error instanceof Error ? error.message : String(error)
                });
                throw error;
            }
        },
        {
            connection: getConnectionOptions(),
            concurrency: userAlertsRuntimeStatus.concurrency,
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 200 }
        }
    );

    worker.on('ready', () => {
        markWorkerReady(userAlertsRuntimeStatus);
        logger.info(`[WORKER] User alerts worker ready on queue: ${QUEUE_NAMES.USER_ALERTS}`);
    });

    worker.on('completed', () => {
        markWorkerJobCompleted(userAlertsRuntimeStatus);
    });

    worker.on('failed', (job, err) => {
        markWorkerJobFailed(userAlertsRuntimeStatus, err);
        if (job) {
            logger.error(`[WORKER] User alerts job ${job.id} failed with error: ${err.message}`);
            void handleFinalFailure(job, err);
        } else {
            logger.error(`[WORKER] User alerts worker failed with error: ${err.message}`);
        }
    });

    worker.on('error', (err) => {
        markWorkerFailed(userAlertsRuntimeStatus, err);
        logger.error(`[WORKER] Redis connection error on user alerts worker: ${err.message}`);
    });

    worker.on('closed', () => {
        markWorkerStopped(userAlertsRuntimeStatus);
        logger.info(`[WORKER] User alerts worker gracefully closed`);
    });
    
    return worker;
}