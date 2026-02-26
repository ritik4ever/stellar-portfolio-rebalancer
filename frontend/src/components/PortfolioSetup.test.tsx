import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PortfolioSetup from './PortfolioSetup'

const postMock = vi.fn()

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        api: {
            ...actual.api,
            post: postMock
        }
    }
})

describe('PortfolioSetup', () => {
    beforeEach(() => {
        postMock.mockReset()
    })

    it('shows validation message and disables submit when total > 100', async () => {
        render(<PortfolioSetup onNavigate={vi.fn()} publicKey={null} />)

        const percentageInput = screen.getAllByRole('spinbutton')[0]
        fireEvent.change(percentageInput, { target: { value: '105' } })

        expect(await screen.findByText(/5% over — reduce allocations/i)).toBeInTheDocument()

        const submit = screen.getAllByRole('button', { name: 'Create Portfolio' }).at(-1)
        expect(submit).toBeDisabled()
    })

    it('submits successfully with balanced preset and navigates to dashboard', async () => {
        vi.useFakeTimers()
        const onNavigate = vi.fn()
        postMock.mockResolvedValue({ portfolioId: 'p1' })

        render(<PortfolioSetup onNavigate={onNavigate} publicKey={null} />)

        fireEvent.click(screen.getByRole('button', { name: 'Balanced' }))
        expect(await screen.findByText(/Allocations sum to 100%/i)).toBeInTheDocument()

        const submit = screen.getAllByRole('button', { name: 'Create Portfolio' }).at(-1)
        expect(submit).toBeEnabled()

        fireEvent.click(submit as HTMLButtonElement)
        expect(await screen.findByText(/Portfolio created successfully/i)).toBeInTheDocument()

        vi.advanceTimersByTime(2000)
        await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('dashboard'))
        vi.useRealTimers()
    })
})
