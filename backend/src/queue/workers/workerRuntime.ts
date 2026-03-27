export interface WorkerRuntimeStatus {
    name: string
    concurrency: number
    started: boolean
    ready: boolean
    lastStartedAt?: string
    lastReadyAt?: string
    lastStoppedAt?: string
    lastError?: string
}

export function createWorkerRuntimeStatus(name: string, concurrency: number): WorkerRuntimeStatus {
    return {
        name,
        concurrency,
        started: false,
        ready: false,
    }
}

export function markWorkerStarting(status: WorkerRuntimeStatus): void {
    status.started = true
    status.ready = false
    status.lastStartedAt = new Date().toISOString()
    status.lastError = undefined
}

export function markWorkerReady(status: WorkerRuntimeStatus): void {
    status.started = true
    status.ready = true
    status.lastReadyAt = new Date().toISOString()
    status.lastError = undefined
}

export function markWorkerFailed(status: WorkerRuntimeStatus, error: unknown): void {
    status.ready = false
    status.lastError = error instanceof Error ? error.message : String(error)
}

export function markWorkerStopped(status: WorkerRuntimeStatus): void {
    status.started = false
    status.ready = false
    status.lastStoppedAt = new Date().toISOString()
}

export function snapshotWorkerRuntimeStatus(status: WorkerRuntimeStatus): WorkerRuntimeStatus {
    return { ...status }
}
