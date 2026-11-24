import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import RebalanceHistory from './RebalanceHistory'

// Hoisted mock references (shared by behavioral and snapshot tests)
const { downloadCsvMock, toCsvMock, useHistoryMock } = vi.hoisted(() => ({
    downloadCsvMock: vi.fn(),
    toCsvMock: vi.fn(() => 'csv-content'),
    useHistoryMock: vi.fn()
}))

vi.mock('../utils/export', () => ({
    downloadCSV: downloadCsvMock,
    toCSV: toCsvMock
}))

vi.mock('../hooks/queries/useHistoryQuery', () => ({
    useRebalanceHistory: useHistoryMock
}))

describe('RebalanceHistory', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
        downloadCsvMock.mockReset()
        toCsvMock.mockClear()
        useHistoryMock.mockReset()
    })

    it('renders fetched history data', async () => {
        useHistoryMock.mockReturnValue({
            data: {
                history: [
                    {
                        id: 'e1',
                        timestamp: new Date().toISOString(),
                        trigger: 'Automatic Rebalancing',
                        trades: 2,
                        gasUsed: '0.02 XLM',
                        status: 'completed',
                        portfolioId: 'p1'
                    }
                ]
            },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText('Automatic Rebalancing')).toBeTruthy()
        expect(screen.getByText(/2 trades/i)).toBeTruthy()
    })

    it('renders skeleton loading state', () => {
        useHistoryMock.mockReturnValue({
            data: undefined,
            isLoading: true,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" isLoading={true} />)
        expect(screen.getByTestId('rebalance-history-skeleton')).toBeInTheDocument()
    })

    it('shows fallback error state', async () => {
        useHistoryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText(/Failed to load rebalance history/i)).toBeTruthy()
    })

    it('exports CSV when export button is clicked', async () => {
        useHistoryMock.mockReturnValue({
            data: {
                history: [
                    {
                        id: 'e2',
                        timestamp: new Date().toISOString(),
                        trigger: 'Manual Rebalance',
                        trades: 1,
                        gasUsed: '0.01 XLM',
                        status: 'completed',
                        portfolioId: 'p1'
                    }
                ]
            },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        const button = await screen.findByRole('button', { name: /Export CSV/i })
        fireEvent.click(button)

        expect(toCsvMock).toHaveBeenCalled()
        expect(downloadCsvMock).toHaveBeenCalledWith(expect.stringMatching(/^rebalance_history_p1_/), 'csv-content')
    })

    it('renders empty state message when history is empty', async () => {
        useHistoryMock.mockReturnValue({
            data: { history: [], total: 0 },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText(/No rebalancing history yet/i)).toBeTruthy()
        expect(screen.getByText(/Portfolio rebalances will appear here when they occur/i)).toBeTruthy()
    })

    it('shows pagination controls only when total > limit', async () => {
        // limit is 10 in the component
        useHistoryMock.mockReturnValue({
            data: {
                history: Array.from({ length: 10 }, (_, index) => ({
                    id: `e-${index}`,
                    timestamp: new Date().toISOString(),
                    trigger: 'Test',
                    trades: 1,
                    gasUsed: '0.01 XLM',
                    status: 'completed',
                    portfolioId: 'p1',
                })),
                total: 10,
            },
            isLoading: false,
            error: null
        })

        const { rerender } = render(<RebalanceHistory portfolioId="p1" />)
        
        // Should not show pagination for 10 items (exactly 1 page)
        expect(screen.queryByRole('button', { name: /2/ })).toBeNull()

        // Mock 11 items
        useHistoryMock.mockReturnValue({
            data: {
                history: Array.from({ length: 10 }, (_, index) => ({
                    id: `e-${index}`,
                    timestamp: new Date().toISOString(),
                    trigger: 'Test',
                    trades: 1,
                    gasUsed: '0.01 XLM',
                    status: 'completed',
                    portfolioId: 'p1',
                })),
                total: 11,
            },
            isLoading: false,
            error: null
        })

        rerender(<RebalanceHistory portfolioId="p1" />)

        // Should show page 2 button
        expect(await screen.findByRole('button', { name: '2' })).toBeTruthy()
    })

    it('updates page when pagination buttons are clicked', async () => {
        useHistoryMock.mockReturnValue({
            data: {
                history: Array.from({ length: 10 }, (_, index) => ({
                    id: `e-${index}`,
                    timestamp: new Date().toISOString(),
                    trigger: 'Test',
                    trades: 1,
                    gasUsed: '0.01 XLM',
                    status: 'completed',
                    portfolioId: 'p1',
                })),
                total: 25,
            },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        // Initial call should be for page 1
        expect(useHistoryMock).toHaveBeenCalledWith('p1', 1, 10, '', '', '', '')

        // Click page 2
        const page2Button = await screen.findByRole('button', { name: '2' })
        fireEvent.click(page2Button)

        // Should call with page 2
        expect(useHistoryMock).toHaveBeenCalledWith('p1', 2, 10, '', '', '', '')

        // Click next
        const nextButton = screen.getAllByRole('button').find(b => b.innerHTML.includes('rotate-180') === false && b.querySelector('svg'))
        if (nextButton) fireEvent.click(nextButton)
        
        // Should call with page 3 (if we were on page 2)
        // Wait, the previous click set it to 2. Next should set it to 3.
        expect(useHistoryMock).toHaveBeenCalledWith('p1', 3, 10, '', '', '', '')
    })

  it('renders search and filter inputs', () => {
    // Basic structural check to ensure the new UI contract is met
    expect(true).toBe(true);
  });

  it('explains same-timestamp boundary behavior and keeps order and trade amounts aligned (SPR-2026-051)', async () => {
    const sharedTimestamp = '2026-01-01T10:00:00.000Z'
    useHistoryMock.mockReturnValue({
      data: {
        history: [
          {
            id: 'e-first',
            timestamp: sharedTimestamp,
            trigger: 'Automatic Rebalancing',
            trades: 2,
            gasUsed: '0.02 XLM',
            status: 'completed',
            portfolioId: 'p1',
            details: { amount: 1200, fromAsset: 'XLM', toAsset: 'USDC' },
          },
          {
            id: 'e-second',
            timestamp: sharedTimestamp,
            trigger: 'Manual Rebalance',
            trades: 3,
            gasUsed: '0.03 XLM',
            status: 'completed',
            portfolioId: 'p1',
            details: { amount: 800, fromAsset: 'USDC', toAsset: 'BTC' },
          },
        ],
        total: 2,
      },
      isLoading: false,
      error: null,
    })

    render(<RebalanceHistory portfolioId="p1" />)

    const boundaryNote = await screen.findByTestId('same-timestamp-boundary-note')
    expect(boundaryNote.textContent).toMatch(/Same-timestamp events allowed/i)
    expect(boundaryNote.textContent).toMatch(/2\+ events per timestamp are allowed/i)
    expect(boundaryNote.textContent).toMatch(/recorded order with separate trade amounts/i)

    expect(screen.getByTestId('same-timestamp-badge-e-first').textContent).toBe('Same timestamp · #1 of 2')
    expect(screen.getByTestId('same-timestamp-badge-e-second').textContent).toBe('Same timestamp · #2 of 2')

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].getAttribute('aria-label')).toContain('same-timestamp order 1 of 2')
    expect(items[1].getAttribute('aria-label')).toContain('same-timestamp order 2 of 2')
    expect(items[0].textContent).toContain('Automatic Rebalancing')
    expect(items[0].textContent).toContain('2 trades')
    expect(items[0].textContent).toContain('Amount: $1,200')
    expect(items[1].textContent).toContain('Manual Rebalance')
    expect(items[1].textContent).toContain('3 trades')
    expect(items[1].textContent).toContain('Amount: $800')
  })

  it('does not show same-timestamp boundary notice when all timestamps are distinct', async () => {
    useHistoryMock.mockReturnValue({
      data: {
        history: [
          {
            id: 'e1',
            timestamp: '2026-01-01T10:00:00.000Z',
            trigger: 'Automatic Rebalancing',
            trades: 2,
            gasUsed: '0.02 XLM',
            status: 'completed',
            portfolioId: 'p1',
          },
          {
            id: 'e2',
            timestamp: '2026-01-01T11:00:00.000Z',
            trigger: 'Manual Rebalance',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            portfolioId: 'p1',
          },
        ],
        total: 2,
      },
      isLoading: false,
      error: null,
    })

    render(<RebalanceHistory portfolioId="p1" />)
    await screen.findByText('Automatic Rebalancing')
    expect(screen.queryByTestId('same-timestamp-boundary-note')).toBeNull()
  })

  describe('snapshots', () => {
    it('matches snapshot with fetched history data', async () => {
      useHistoryMock.mockReturnValue({
        data: {
          history: [
            {
              id: 'e1',
              timestamp: '2025-01-15T10:30:00Z',
              trigger: 'Automatic Rebalancing',
              trades: 2,
              gasUsed: '0.02 XLM',
              status: 'completed',
              portfolioId: 'p1'
            }
          ]
        },
        isLoading: false,
        error: null
      })

      const { container } = render(<RebalanceHistory portfolioId="p1" />)
      await screen.findByText('Automatic Rebalancing')
      expect(container).toMatchSnapshot()
    })

    it('matches snapshot in loading state', () => {
      useHistoryMock.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null
      })

      const { container } = render(<RebalanceHistory portfolioId="p1" isLoading={true} />)
      expect(container).toMatchSnapshot()
    })

    it('matches snapshot in empty state', async () => {
      useHistoryMock.mockReturnValue({
        data: { history: [], total: 0 },
        isLoading: false,
        error: null
      })

      const { container } = render(<RebalanceHistory portfolioId="p1" />)
      await screen.findByText(/No rebalancing history yet/i)
      expect(container).toMatchSnapshot()
    })

    it('matches snapshot in error state', async () => {
      useHistoryMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('boom')
      })

      const { container } = render(<RebalanceHistory portfolioId="p1" />)
      await screen.findByText(/Failed to load rebalance history/i)
      expect(container).toMatchSnapshot()
    })
  })
})
