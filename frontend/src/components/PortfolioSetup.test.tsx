import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortfolioSetup from './PortfolioSetup'
import { api } from '../config/api'

// Strip framer-motion animation props so they don't hit the real DOM
const stripMotionProps = ({ initial, animate, exit, transition, variants, layout, layoutId, ...rest }: any) => rest

vi.mock('framer-motion', () => ({
    motion: {
        div: (props: any) => React.createElement('div', stripMotionProps(props), props.children),
        p: (props: any) => React.createElement('p', stripMotionProps(props), props.children),
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}))

vi.mock('./ThemeToggle', () => ({ default: () => null }))

const mockMutateAsync = vi.fn()
vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
    useCreatePortfolioMutation: () => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
    }),
}))

function renderSetup(publicKey: string | null = null) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const onNavigate = vi.fn()
    const utils = render(
        <QueryClientProvider client={client}>
            <PortfolioSetup onNavigate={onNavigate} publicKey={publicKey} />
        </QueryClientProvider>
    )
    return { ...utils, onNavigate }
}

/**
 * The balanced template (default) allocates:
 *   USDC 40%  XLM 30%  BTC 20%  ETH 10%  → total 100%
 *
 * getAllByRole('spinbutton') order for the balanced template:
 *   [0] USDC %   [1] XLM %   [2] BTC %   [3] ETH %
 *   [4] threshold (min 1, max 50, default 5)
 *   [5] slippage  (min 0.1, max 5, default 1)
 */

describe('PortfolioSetup allocation validation', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockMutateAsync.mockResolvedValue({})
        // Return empty assets so the component falls back to DEFAULT_ASSET_OPTIONS
        vi.spyOn(api, 'get').mockResolvedValue({ assets: [] } as any)
    })

    // ── Sum-to-100 boundary tests ─────────────────────────────────────────────

    describe('sum-to-100 boundary validation', () => {
        it('enables submit when allocations sum to exactly 100%', () => {
            renderSetup()
            const submit = screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement
            expect(submit.disabled).toBe(false)
        })

        it('shows success status message when total equals 100%', () => {
            renderSetup()
            expect(screen.getByText(/allocations sum to 100%/i)).toBeTruthy()
        })

        it('disables submit and shows under-allocation message when total is 99%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            // ETH: 10 → 9, total becomes 99%
            fireEvent.change(inputs[3], { target: { value: '9' } })

            const submit = screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement
            expect(submit.disabled).toBe(true)
            expect(screen.getByText(/1% under/i)).toBeTruthy()
        })

        it('disables submit and shows over-allocation message when total is 101%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            // ETH: 10 → 11, total becomes 101%
            fireEvent.change(inputs[3], { target: { value: '11' } })

            const submit = screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement
            expect(submit.disabled).toBe(true)
            expect(screen.getByText(/1% over/i)).toBeTruthy()
        })

        it('re-enables submit when total is corrected back to 100%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')

            fireEvent.change(inputs[3], { target: { value: '9' } })
            expect((screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement).disabled).toBe(true)

            fireEvent.change(inputs[3], { target: { value: '10' } })
            expect((screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement).disabled).toBe(false)
        })

        it('shows hint text beneath submit button when total is not 100%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            fireEvent.change(inputs[3], { target: { value: '5' } })

            expect(screen.getByText(/fix validation errors above to continue/i)).toBeTruthy()
        })
    })

    // ── Field-level error messages ────────────────────────────────────────────

    describe('field-level validation errors', () => {
        it('shows "Cannot be negative" and disables submit for a negative percentage', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            fireEvent.change(inputs[0], { target: { value: '-1' } })

            expect(screen.getByText(/cannot be negative/i)).toBeTruthy()
            expect((screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement).disabled).toBe(true)
        })

        it('shows "Cannot exceed 100%" and disables submit when percentage is over 100', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            fireEvent.change(inputs[0], { target: { value: '150' } })

            expect(screen.getByText(/cannot exceed 100%/i)).toBeTruthy()
            expect((screen.getByRole('button', { name: /create portfolio/i }) as HTMLButtonElement).disabled).toBe(true)
        })

        it('clears field error when value is corrected to a valid range', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')

            fireEvent.change(inputs[0], { target: { value: '-5' } })
            expect(screen.getByText(/cannot be negative/i)).toBeTruthy()

            fireEvent.change(inputs[0], { target: { value: '40' } })
            expect(screen.queryByText(/cannot be negative/i)).toBeNull()
        })
    })

    // ── Adding and removing assets ────────────────────────────────────────────

    describe('adding and removing assets', () => {
        it('disables Add Asset when all supported asset slots are in use', () => {
            renderSetup()
            // Balanced template uses all 4 DEFAULT_ASSET_OPTIONS
            const addBtn = screen.getByRole('button', { name: /\badd asset\b/i }) as HTMLButtonElement
            expect(addBtn.disabled).toBe(true)
        })

        it('adds a new allocation row when clicking Add Asset', () => {
            renderSetup()
            // Conservative (3 assets) frees one slot → Add Asset becomes enabled
            fireEvent.click(screen.getByRole('button', { name: /conservative/i }))

            const before = screen.getAllByRole('spinbutton').length
            const addBtn = screen.getByRole('button', { name: /\badd asset\b/i }) as HTMLButtonElement
            expect(addBtn.disabled).toBe(false)

            fireEvent.click(addBtn)
            expect(screen.getAllByRole('spinbutton').length).toBe(before + 1)
        })

        it('removes an allocation row when clicking a delete button', () => {
            const { container } = renderSetup()
            const before = screen.getAllByRole('spinbutton').length

            // Delete buttons carry the text-red-500 class; savedTemplates is empty so
            // these are exclusively the per-row allocation delete buttons
            const deleteButtons = container.querySelectorAll('button.text-red-500')
            expect(deleteButtons.length).toBeGreaterThan(0)

            fireEvent.click(deleteButtons[0])
            expect(screen.getAllByRole('spinbutton').length).toBe(before - 1)
        })

        it('hides delete button when only one allocation row remains', () => {
            const { container } = renderSetup()
            // Custom template starts with a single asset (XLM 100%)
            fireEvent.click(screen.getByRole('button', { name: /custom/i }))

            const deleteButtons = container.querySelectorAll('button.text-red-500')
            expect(deleteButtons.length).toBe(0)
        })
    })

    // ── Slippage and threshold fields ─────────────────────────────────────────

    describe('slippage and threshold field validation ranges', () => {
        it('threshold input enforces min=1 and max=50', () => {
            renderSetup()
            const threshold = screen.getAllByRole('spinbutton')[4] as HTMLInputElement
            expect(threshold.min).toBe('1')
            expect(threshold.max).toBe('50')
        })

        it('slippage input enforces min=0.1 and max=5', () => {
            renderSetup()
            const slippage = screen.getAllByRole('spinbutton')[5] as HTMLInputElement
            expect(slippage.min).toBe('0.1')
            expect(slippage.max).toBe('5')
        })

        it('updates the threshold value when changed', () => {
            renderSetup()
            const threshold = screen.getAllByRole('spinbutton')[4] as HTMLInputElement
            fireEvent.change(threshold, { target: { value: '10' } })
            expect(threshold.value).toBe('10')
        })

        it('updates the slippage value when changed', () => {
            renderSetup()
            const slippage = screen.getAllByRole('spinbutton')[5] as HTMLInputElement
            fireEvent.change(slippage, { target: { value: '2.5' } })
            expect(slippage.value).toBe('2.5')
        })
    })

    // ── Submit button state ───────────────────────────────────────────────────

    describe('submit button state', () => {
        it('calls mutateAsync when form is valid and submit is clicked', async () => {
            renderSetup()
            fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
            expect(mockMutateAsync).toHaveBeenCalledTimes(1)
        })

        it('does not call mutateAsync when total is not 100%', () => {
            renderSetup()
            const inputs = screen.getAllByRole('spinbutton')
            fireEvent.change(inputs[3], { target: { value: '5' } })

            fireEvent.click(screen.getByRole('button', { name: /create portfolio/i }))
            expect(mockMutateAsync).not.toHaveBeenCalled()
        })
    })
})
