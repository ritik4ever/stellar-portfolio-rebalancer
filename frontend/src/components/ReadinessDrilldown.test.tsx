import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ReadinessDrilldown from './ReadinessDrilldown'
import type { ReadinessReport } from '../hooks/useReadinessReport'
import type { ReadinessHistoryEntry } from '../hooks/useReadinessHistory'

afterEach(cleanup)

function makeReport(overrides: Partial<ReadinessReport['checks']> = {}): ReadinessReport {
    const ready = { status: 'ready' as const, required: true, message: 'ok' }
    const disabled = { status: 'disabled' as const, required: false, message: 'off' }
    return {
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
            database: overrides.database ?? ready,
            queue: overrides.queue ?? disabled,
            workers: overrides.workers ?? disabled,
            contractEventIndexer: overrides.contractEventIndexer ?? disabled,
            autoRebalancer: overrides.autoRebalancer ?? disabled,
        },
    }
}

describe('ReadinessDrilldown', () => {
    it('renders nothing when report is ready and no error', () => {
        const report: ReadinessReport = {
            status: 'ready',
            timestamp: new Date().toISOString(),
            checks: {
                database: { status: 'ready', required: true, message: 'ok' },
                queue: { status: 'ready', required: true, message: 'ok' },
                workers: { status: 'ready', required: true, message: 'ok' },
                contractEventIndexer: { status: 'ready', required: false, message: 'ok' },
                autoRebalancer: { status: 'ready', required: false, message: 'ok' },
            },
        }
        const { container } = render(
            <ReadinessDrilldown report={report} loading={false} loadError={false} />,
        )
        expect(container.firstChild).toBeNull()
    })

    it('shows loading spinner and label while loading', () => {
        render(<ReadinessDrilldown report={null} loading loadError={false} />)
        expect(screen.getByText(/checking services/i)).toBeInTheDocument()
    })

    it('shows error label when loadError is true', () => {
        render(<ReadinessDrilldown report={null} loading={false} loadError />)
        expect(screen.getByText(/service status unavailable/i)).toBeInTheDocument()
    })

    it('shows degraded label when report is not_ready', () => {
        render(<ReadinessDrilldown report={makeReport()} loading={false} loadError={false} />)
        expect(screen.getByText(/some services degraded/i)).toBeInTheDocument()
    })

    it('expands panel on click and shows dependency rows', () => {
        const report = makeReport({
            database: { status: 'not_ready', required: true, message: 'connection refused' },
        })
        render(<ReadinessDrilldown report={report} loading={false} loadError={false} />)

        const toggle = screen.getByRole('button')
        expect(toggle).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(toggle)

        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('list')).toBeInTheDocument()
        expect(screen.getByText('Database')).toBeInTheDocument()
        expect(screen.getByText(/connection refused/i)).toBeInTheDocument()
    })

    it('collapses panel on second click', () => {
        render(<ReadinessDrilldown report={makeReport()} loading={false} loadError={false} />)
        const toggle = screen.getByRole('button')
        fireEvent.click(toggle)
        expect(screen.getByRole('list')).toBeInTheDocument()
        fireEvent.click(toggle)
        expect(screen.queryByRole('list')).toBeNull()
    })

    it('shows all five dependency labels when expanded', () => {
        render(<ReadinessDrilldown report={makeReport()} loading={false} loadError={false} />)
        fireEvent.click(screen.getByRole('button'))
        expect(screen.getByText('Database')).toBeInTheDocument()
        expect(screen.getByText('Job Queue')).toBeInTheDocument()
        expect(screen.getByText('Workers')).toBeInTheDocument()
        expect(screen.getByText('Event Indexer')).toBeInTheDocument()
        expect(screen.getByText('Auto-Rebalancer')).toBeInTheDocument()
    })

    it('shows error message in panel when loadError and no report', () => {
        render(<ReadinessDrilldown report={null} loading={false} loadError />)
        fireEvent.click(screen.getByRole('button'))
        expect(screen.getByText(/could not reach/i)).toBeInTheDocument()
    })

    it('does not show message for ready checks', () => {
        const report = makeReport({
            database: { status: 'ready', required: true, message: 'ok' },
        })
        render(<ReadinessDrilldown report={report} loading={false} loadError={false} />)
        fireEvent.click(screen.getByRole('button'))
        // "ok" message should not appear for ready checks
        expect(screen.queryByText(/— ok/)).toBeNull()
    })

    describe('historical timeline', () => {
        function makeHistoryEntry(overrides: Partial<ReadinessHistoryEntry> = {}): ReadinessHistoryEntry {
            return {
                status: 'ready',
                timestamp: new Date().toISOString(),
                summary: 'All systems operational',
                ...overrides,
            }
        }

        it('shows history section when history data is provided', () => {
            const history = [
                makeHistoryEntry({ status: 'ready', summary: 'All systems operational' }),
                makeHistoryEntry({ status: 'not_ready', summary: 'Database connection lost' }),
            ]
            render(
                <ReadinessDrilldown
                    report={makeReport()}
                    loading={false}
                    loadError={false}
                    history={history}
                    historyLoading={false}
                    historyError={false}
                />,
            )
            fireEvent.click(screen.getByRole('button'))
            expect(screen.getByText('Readiness history')).toBeInTheDocument()
            expect(screen.getByText('All systems operational')).toBeInTheDocument()
            expect(screen.getByText('Database connection lost')).toBeInTheDocument()
        })

        it('shows loading indicator when history is loading', () => {
            render(
                <ReadinessDrilldown
                    report={makeReport()}
                    loading={false}
                    loadError={false}
                    history={[]}
                    historyLoading
                    historyError={false}
                />,
            )
            fireEvent.click(screen.getByRole('button'))
            expect(screen.getByText('Loading history...')).toBeInTheDocument()
        })

        it('shows error when history fails to load', () => {
            render(
                <ReadinessDrilldown
                    report={makeReport()}
                    loading={false}
                    loadError={false}
                    history={[]}
                    historyLoading={false}
                    historyError
                />,
            )
            fireEvent.click(screen.getByRole('button'))
            expect(screen.getByText('Could not load readiness history.')).toBeInTheDocument()
        })

        it('visually distinguishes degraded periods from healthy periods', () => {
            const history = [
                makeHistoryEntry({ status: 'ready', summary: 'All systems operational', timestamp: new Date(Date.now() - 120000).toISOString() }),
                makeHistoryEntry({ status: 'not_ready', summary: 'Queue unavailable', timestamp: new Date(Date.now() - 60000).toISOString() }),
                makeHistoryEntry({ status: 'ready', summary: 'Recovered', timestamp: new Date().toISOString() }),
            ]
            render(
                <ReadinessDrilldown
                    report={makeReport()}
                    loading={false}
                    loadError={false}
                    history={history}
                />,
            )
            fireEvent.click(screen.getByRole('button'))

            const dots = document.querySelectorAll('span.inline-block.h-2.w-2')
            expect(dots.length).toBe(3)
        })

        it('renders correctly for a mixed healthy/degraded sample dataset', () => {
            const history = [
                makeHistoryEntry({ status: 'ready', summary: 'All systems operational', timestamp: '2025-06-01T08:00:00Z' }),
                makeHistoryEntry({ status: 'not_ready', summary: 'Indexer sync failed', timestamp: '2025-06-01T08:05:00Z' }),
                makeHistoryEntry({ status: 'not_ready', summary: 'Database timeout', timestamp: '2025-06-01T08:10:00Z' }),
                makeHistoryEntry({ status: 'ready', summary: 'Back to normal', timestamp: '2025-06-01T08:15:00Z' }),
            ]
            render(
                <ReadinessDrilldown
                    report={makeReport()}
                    loading={false}
                    loadError={false}
                    history={history}
                />,
            )
            fireEvent.click(screen.getByRole('button'))

            expect(screen.getByText('Readiness history')).toBeInTheDocument()
            expect(screen.getByText('All systems operational')).toBeInTheDocument()
            expect(screen.getByText('Indexer sync failed')).toBeInTheDocument()
            expect(screen.getByText('Database timeout')).toBeInTheDocument()
            expect(screen.getByText('Back to normal')).toBeInTheDocument()
        })
    })
})
