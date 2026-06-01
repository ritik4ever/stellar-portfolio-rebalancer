import { describe, expect, it } from 'vitest'
import { decideMissedJobRecovery, type ScheduledTaskRecoveryConfig } from '../queue/schedulerRecovery.js'

const tasks: ScheduledTaskRecoveryConfig[] = [
    {
        name: 'portfolio-check',
        intervalMs: 30 * 60 * 1000,
        recoveryAction: 'compact',
        recoveryReason: 'current-state portfolio check',
    },
    {
        name: 'analytics-snapshot',
        intervalMs: 60 * 60 * 1000,
        recoveryAction: 'compact',
        recoveryReason: 'current-state analytics snapshot',
    },
]

describe('queue scheduler missed-job recovery', () => {
    it('skips recovery on first startup when no checkpoint exists', () => {
        const decisions = decideMissedJobRecovery(tasks, null, new Date('2026-06-01T12:00:00.000Z'))

        expect(decisions).toEqual([
            expect.objectContaining({
                taskName: 'portfolio-check',
                action: 'skip',
                missedRuns: 0,
                reason: expect.stringContaining('first startup'),
            }),
            expect.objectContaining({
                taskName: 'analytics-snapshot',
                action: 'skip',
                missedRuns: 0,
                reason: expect.stringContaining('first startup'),
            }),
        ])
    })

    it('compacts due tasks into one recovery decision per task', () => {
        const decisions = decideMissedJobRecovery(
            tasks,
            '2026-06-01T10:25:00.000Z',
            new Date('2026-06-01T12:00:00.000Z'),
        )

        expect(decisions).toEqual([
            expect.objectContaining({
                taskName: 'portfolio-check',
                action: 'compact',
                missedRuns: 3,
                lastSchedulerSeenAt: '2026-06-01T10:25:00.000Z',
            }),
            expect.objectContaining({
                taskName: 'analytics-snapshot',
                action: 'compact',
                missedRuns: 1,
                lastSchedulerSeenAt: '2026-06-01T10:25:00.000Z',
            }),
        ])
    })

    it('skips tasks whose interval did not elapse during downtime', () => {
        const decisions = decideMissedJobRecovery(
            tasks,
            '2026-06-01T11:45:00.000Z',
            new Date('2026-06-01T12:00:00.000Z'),
        )

        expect(decisions).toEqual([
            expect.objectContaining({
                taskName: 'portfolio-check',
                action: 'skip',
                missedRuns: 0,
            }),
            expect.objectContaining({
                taskName: 'analytics-snapshot',
                action: 'skip',
                missedRuns: 0,
            }),
        ])
    })

    it('treats invalid checkpoints as non-recoverable and actionable', () => {
        const decisions = decideMissedJobRecovery(tasks, 'not-a-date', new Date('2026-06-01T12:00:00.000Z'))

        expect(decisions).toEqual([
            expect.objectContaining({
                taskName: 'portfolio-check',
                action: 'skip',
                reason: expect.stringContaining('invalid'),
            }),
            expect.objectContaining({
                taskName: 'analytics-snapshot',
                action: 'skip',
                reason: expect.stringContaining('invalid'),
            }),
        ])
    })
})
