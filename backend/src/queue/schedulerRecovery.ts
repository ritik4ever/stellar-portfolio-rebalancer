const MINUTE_MS = 60_000

export type MissedJobRecoveryAction = 'replay' | 'skip' | 'compact'
export type ScheduledTaskName = 'portfolio-check' | 'analytics-snapshot' | 'idempotency-cleanup'

export interface ScheduledTaskRecoveryConfig {
    name: ScheduledTaskName
    intervalMs: number
    recoveryAction: MissedJobRecoveryAction
    recoveryReason: string
}

export interface MissedJobRecoveryDecision {
    taskName: ScheduledTaskName
    action: MissedJobRecoveryAction
    missedRuns: number
    lastSchedulerSeenAt?: string
    recoveredAt: string
    reason: string
}

export const SCHEDULED_TASK_RECOVERY_CONFIGS: ScheduledTaskRecoveryConfig[] = [
    {
        name: 'portfolio-check',
        intervalMs: 30 * MINUTE_MS,
        recoveryAction: 'compact',
        recoveryReason: 'portfolio checks operate on current portfolio state, so one catch-up check covers missed intervals',
    },
    {
        name: 'analytics-snapshot',
        intervalMs: 60 * MINUTE_MS,
        recoveryAction: 'compact',
        recoveryReason: 'historical market state cannot be reconstructed after downtime, so one current snapshot is captured',
    },
    {
        name: 'idempotency-cleanup',
        intervalMs: 60 * MINUTE_MS,
        recoveryAction: 'compact',
        recoveryReason: 'expired idempotency keys can be cleaned in one catch-up pass',
    },
]

export function decideMissedJobRecovery(
    tasks: ScheduledTaskRecoveryConfig[] = SCHEDULED_TASK_RECOVERY_CONFIGS,
    lastSchedulerSeenAt: string | null,
    recoveredAt: Date = new Date(),
): MissedJobRecoveryDecision[] {
    const recoveredAtIso = recoveredAt.toISOString()
    const lastSeenTime = lastSchedulerSeenAt ? Date.parse(lastSchedulerSeenAt) : NaN

    if (!lastSchedulerSeenAt || Number.isNaN(lastSeenTime)) {
        return tasks.map((task) => ({
            taskName: task.name,
            action: 'skip',
            missedRuns: 0,
            recoveredAt: recoveredAtIso,
            reason: lastSchedulerSeenAt
                ? 'previous scheduler checkpoint was invalid; skipping catch-up to avoid duplicate work'
                : 'no previous scheduler checkpoint exists; treating this as first startup',
        }))
    }

    const elapsedMs = Math.max(0, recoveredAt.getTime() - lastSeenTime)

    return tasks.map((task) => {
        const missedRuns = Math.floor(elapsedMs / task.intervalMs)

        if (missedRuns < 1) {
            return {
                taskName: task.name,
                action: 'skip',
                missedRuns,
                lastSchedulerSeenAt,
                recoveredAt: recoveredAtIso,
                reason: 'scheduler downtime did not cross the task interval',
            }
        }

        return {
            taskName: task.name,
            action: task.recoveryAction,
            missedRuns,
            lastSchedulerSeenAt,
            recoveredAt: recoveredAtIso,
            reason: task.recoveryReason,
        }
    })
}
