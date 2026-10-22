import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordHorizonSubmissionRetry } from '../observability/metrics.js'

describe('Horizon submission retry backoff (#1177)', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('records retry metrics with status code and outcome', () => {
        const counterSpy = vi.spyOn(require('../observability/metrics.js').horizonSubmissionRetriesTotal, 'inc')
        const histogramSpy = vi.spyOn(require('../observability/metrics.js').horizonSubmissionRetryDuration, 'observe')

        recordHorizonSubmissionRetry({
            statusCode: 429,
            durationSeconds: 2.5,
            outcome: 'success'
        })

        expect(counterSpy).toHaveBeenCalledWith({ status_code: '429' })
        expect(histogramSpy).toHaveBeenCalledWith(
            { status_code: '429', outcome: 'success' },
            2.5
        )
    })

    it('handles metric emission failure gracefully', () => {
        const counterSpy = vi.spyOn(require('../observability/metrics.js').horizonSubmissionRetriesTotal, 'inc').mockImplementation(() => {
            throw new Error('Metrics system unavailable')
        })

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(() => {
            recordHorizonSubmissionRetry({
                statusCode: 503,
                durationSeconds: 1.0,
                outcome: 'failure'
            })
        }).not.toThrow()

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[METRICS]',
            'Failed to record Horizon retry:',
            expect.any(Error)
        )

        consoleErrorSpy.mockRestore()
    })

    it('records both success and failure outcomes', () => {
        const counterSpy = vi.spyOn(require('../observability/metrics.js').horizonSubmissionRetriesTotal, 'inc')

        recordHorizonSubmissionRetry({
            statusCode: 429,
            durationSeconds: 1.5,
            outcome: 'success'
        })

        recordHorizonSubmissionRetry({
            statusCode: 429,
            durationSeconds: 3.0,
            outcome: 'failure'
        })

        expect(counterSpy).toHaveBeenCalledTimes(2)
    })
})
