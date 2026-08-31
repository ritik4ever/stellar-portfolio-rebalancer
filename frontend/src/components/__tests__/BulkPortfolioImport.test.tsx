import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import BulkPortfolioImport from '../BulkPortfolioImport'
import type { BulkImportSuccessResponse, BulkImportRowError } from '../../hooks/mutations/useBulkImport'

const mockMutateAsync = vi.hoisted(() => vi.fn())
const mockUseBulkImport = vi.hoisted(() => vi.fn())
const pendingState = vi.hoisted(() => ({ value: false }))

vi.mock('../../hooks/mutations/useBulkImport', () => ({
  useBulkImport: mockUseBulkImport,
}))

const csvContent = 'asset,allocation_pct\nXLM,50\nUSDC,50\n'
const csvFile = new File([csvContent], 'allocations.csv', { type: 'text/csv' })

function renderComponent(onImported = vi.fn()) {
  return {
    onImported,
    ...render(<BulkPortfolioImport onImported={onImported} />),
  }
}

function getDropZone() {
  return screen.getByRole('button', { name: /drop csv or json file/i })
}

function dropFile(file: File) {
  fireEvent.drop(getDropZone(), { dataTransfer: { files: [file] } })
}

describe('BulkPortfolioImport', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    pendingState.value = false
    mockUseBulkImport.mockImplementation(() => ({
      mutateAsync: mockMutateAsync,
      isPending: pendingState.value,
    }))
  })

  it('renders a drag and drop zone with click to browse hint', () => {
    renderComponent()
    expect(getDropZone()).toBeTruthy()
    expect(screen.getByText(/Drag & drop your CSV or JSON file here/)).toBeTruthy()
    expect(screen.getByText(/click to browse/)).toBeTruthy()
  })

  it('selects a dropped file and shows its name', () => {
    renderComponent()
    dropFile(csvFile)
    expect(screen.getByText(/Selected:/)).toBeTruthy()
    expect(screen.getByText(/allocations\.csv/)).toBeTruthy()
  })

  it('highlights the drop zone while a file is dragged over', () => {
    renderComponent()
    const zone = getDropZone()
    fireEvent.dragEnter(zone)
    expect(screen.getByText('Drop your file here')).toBeTruthy()
    fireEvent.dragLeave(zone)
    expect(screen.getByText(/Drag & drop your CSV or JSON file here/)).toBeTruthy()
  })

  it('shows an upload progress indicator while importing', async () => {
    let resolveImport: (v: BulkImportSuccessResponse) => void = () => {}
    mockMutateAsync.mockReturnValue(
      new Promise<BulkImportSuccessResponse>((resolve) => {
        resolveImport = resolve
      }),
    )

    const { rerender } = renderComponent()
    dropFile(csvFile)
    fireEvent.click(screen.getByText('Import'))

    pendingState.value = true
    rerender(<BulkPortfolioImport onImported={vi.fn()} />)

    const progressbar = await screen.findByRole('progressbar')
    expect(progressbar).toBeTruthy()
    expect(screen.getByText(/Uploading\.\.\./)).toBeTruthy()

    resolveImport({ portfolioId: 'portfolio-pending', status: 'created' })
    pendingState.value = false
    rerender(<BulkPortfolioImport onImported={vi.fn()} />)
  })

  it('calls onImported and shows a success summary after a successful import', async () => {
    const { onImported } = renderComponent()
    mockMutateAsync.mockResolvedValue({ portfolioId: 'portfolio-abc', status: 'created' })

    dropFile(csvFile)
    fireEvent.click(screen.getByText('Import'))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith('portfolio-abc'))
    expect(screen.getByText(/Import successful — portfolio created\./)).toBeTruthy()
    expect(screen.getByText(/Portfolio ID: portfolio-abc/)).toBeTruthy()
  })

  it('surfaces per-row validation errors and a valid/total summary', async () => {
    const rowErrors: BulkImportRowError[] = [
      { row: 1, field: 'asset', message: 'Invalid asset symbol' },
    ]
    const err = new Error('Import failed: validation errors') as Error & {
      rowErrors: BulkImportRowError[]
      totalRows: number
      validRows: number
    }
    err.rowErrors = rowErrors
    err.totalRows = 2
    err.validRows = 0
    mockMutateAsync.mockRejectedValue(err)

    renderComponent()
    dropFile(csvFile)
    fireEvent.click(screen.getByText('Import'))

    await waitFor(() => {
      expect(screen.getByText('Import failed: validation errors')).toBeTruthy()
      expect(screen.getByText('Rows: 0 valid / 2 total')).toBeTruthy()
    })
    expect(screen.getAllByText(/Invalid asset symbol/).length).toBeGreaterThan(0)
  })
})
