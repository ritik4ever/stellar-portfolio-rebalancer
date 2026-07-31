import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import RebalanceTimeline from './RebalanceTimeline'

const mocks = vi.hoisted(() => ({
  useRebalanceHistory: vi.fn(),
  downloadBlob: vi.fn(),
}))

vi.mock('../hooks/queries/useHistoryQuery', () => ({
  useRebalanceHistory: mocks.useRebalanceHistory,
}))

vi.mock('../utils/export', () => ({
  downloadBlob: mocks.downloadBlob,
}))

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mocks.useRebalanceHistory.mockReturnValue({
    data: {
      history: [
        {
          id: 'e1',
          timestamp: new Date(Date.now() - 7200000).toISOString(),
          trigger: 'Threshold exceeded (8.2%)',
          trades: 3,
          gasUsed: '0.0234 XLM',
          status: 'completed' as const,
          portfolioId: 'p1',
        },
        {
          id: 'e2',
          timestamp: new Date(Date.now() - 86400000).toISOString(),
          trigger: 'Scheduled rebalance',
          trades: 2,
          gasUsed: '0.0156 XLM',
          status: 'completed' as const,
          portfolioId: 'p1',
        },
      ],
    },
    isLoading: false,
    error: null,
  })
})

describe('RebalanceTimeline', () => {
  it('renders timeline with history data', () => {
    render(<RebalanceTimeline portfolioId="p1" />)
    expect(screen.getByText('Threshold exceeded (8.2%)')).toBeTruthy()
    expect(screen.getByText('Scheduled rebalance')).toBeTruthy()
  })

  it('shows export and share buttons', () => {
    render(<RebalanceTimeline portfolioId="p1" />)
    expect(screen.getByText('Export')).toBeTruthy()
    expect(screen.getByText('Share')).toBeTruthy()
  })

  it('export action produces an image blob without throwing', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      font: '',
      strokeStyle: '',
      lineWidth: 1,
      fillText: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
    })) as any

    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(['fake-image'], { type: 'image/png' }))
    })

    render(<RebalanceTimeline portfolioId="p1" />)
    const exportBtn = screen.getByText('Export')
    fireEvent.click(exportBtn)
    await vi.waitFor(() => {
      expect(mocks.downloadBlob).toHaveBeenCalled()
    })
    const filename = mocks.downloadBlob.mock.calls[0][0]
    expect(filename).toMatch(/\.png$/)
  })
})
