import { persistWorkerStatus } from './workerHeartbeat.js';
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

