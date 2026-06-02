import { persistWorkerStatus } from './workerHeartbeat.js';

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
