import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processAnalyticsCompactionJob } from '../queue/workers/analyticsCompactionWorker.js'
import { analyticsService } from '../services/analyticsService.js'
import type { Job } from 'bullmq'

vi.mock('../services/analyticsService', () => ({
    analyticsService: {
        compactAllPortfolios: vi.fn(),
    }
}))

describe('Analytics Compaction Worker', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('processAnalyticsCompactionJob', () => {
        it('should call compactAllPortfolios with default parameters', async () => {
            const mockJob = {
                id: 'test-job-1',
                data: {
                    triggeredBy: 'scheduler',
                    correlationId: 'corr-123',
                }
            } as unknown as Job

            vi.mocked(analyticsService.compactAllPortfolios).mockResolvedValue([
                {
                    portfolioId: 'portfolio-1',
                    deletedCount: 100,
                    retainedCount: 50,
                    compactionCutoffTimestamp: new Date().toISOString(),
                }
            ])

            await processAnalyticsCompactionJob(mockJob)

            expect(vi.mocked(analyticsService.compactAllPortfolios)).toHaveBeenCalledWith(90, 7)
        })

        it('should call compactAllPortfolios with custom parameters', async () => {
            const mockJob = {
                id: 'test-job-2',
                data: {
                    triggeredBy: 'manual',
                    correlationId: 'corr-456',
                    cutoffDays: 60,
                    recentDays: 14,
                }
            } as unknown as Job

            vi.mocked(analyticsService.compactAllPortfolios).mockResolvedValue([])

            await processAnalyticsCompactionJob(mockJob)

            expect(vi.mocked(analyticsService.compactAllPortfolios)).toHaveBeenCalledWith(60, 14)
        })

        it('should handle empty portfolio results', async () => {
            const mockJob = {
                id: 'test-job-3',
                data: {
                    triggeredBy: 'scheduler',
                    correlationId: 'corr-789',
                }
            } as unknown as Job

            vi.mocked(analyticsService.compactAllPortfolios).mockResolvedValue([])

            await expect(processAnalyticsCompactionJob(mockJob)).resolves.toBeUndefined()

            expect(vi.mocked(analyticsService.compactAllPortfolios)).toHaveBeenCalledTimes(1)
        })

        it('should propagate errors from analytics service', async () => {
            const mockJob = {
                id: 'test-job-4',
                data: {
                    triggeredBy: 'scheduler',
                    correlationId: 'corr-000',
                }
            } as unknown as Job

            const testError = new Error('Compaction failed')
            vi.mocked(analyticsService.compactAllPortfolios).mockRejectedValue(testError)

            await expect(processAnalyticsCompactionJob(mockJob)).rejects.toThrow('Compaction failed')
        })

        it('should handle job with missing correlationId', async () => {
            const mockJob = {
                id: 'test-job-5',
                data: {
                    triggeredBy: 'scheduler',
                    // correlationId is undefined
                }
            } as unknown as Job

            vi.mocked(analyticsService.compactAllPortfolios).mockResolvedValue([])

            await expect(processAnalyticsCompactionJob(mockJob)).resolves.toBeUndefined()
        })
    })
})
