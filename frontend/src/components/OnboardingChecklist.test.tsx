import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OnboardingChecklist from './OnboardingChecklist'
import React from 'react'

vi.mock('../config/api', () => ({
    api: { get: vi.fn().mockResolvedValue({ data: [] }) },
    ENDPOINTS: {
        PORTFOLIOS: '/portfolios',
        USER_PORTFOLIOS: '/user',
        REBALANCE_HISTORY: '/rebalance/history',
    },
}))

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
    },
})

function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
}

beforeEach(() => {
    try {
        window.localStorage.clear()
    } catch {
        // localStorage not available in test environment
    }
    queryClient.clear()
})

describe('OnboardingChecklist', () => {
    it('shows automatically on first visit when no localStorage entry', async () => {
        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        expect(screen.getByText('Connect Wallet')).toBeInTheDocument()
        expect(screen.getByText('Create Portfolio')).toBeInTheDocument()
        expect(screen.getByText('Set Allocations')).toBeInTheDocument()
        expect(screen.getByText('Execute First Rebalance')).toBeInTheDocument()
        expect(screen.getByText('Enable Auto-Rebalance')).toBeInTheDocument()
    })

    it('can be dismissed and sets localStorage', async () => {
        const user = userEvent.setup()
        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        await user.click(screen.getByLabelText('Dismiss checklist'))

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        })
        expect(localStorage.getItem('onboarding-checklist-dismissed')).toBe('1')
    })

    it('dismissed state persists and does not show dialog', async () => {
        localStorage.setItem('onboarding-checklist-dismissed', '1')

        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await new Promise((r) => setTimeout(r, 1500))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('shows re-open button when dismissed but not all steps completed', async () => {
        const user = userEvent.setup()
        localStorage.setItem('onboarding-checklist-dismissed', '1')

        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await waitFor(() => {
            expect(screen.getByLabelText('Open onboarding checklist')).toBeInTheDocument()
        })

        await user.click(screen.getByLabelText('Open onboarding checklist'))
        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
    })

    it('calls onNavigate with href when a step is clicked', async () => {
        const user = userEvent.setup()
        const onNavigate = vi.fn()

        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate,
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        await user.click(screen.getByText('Connect Wallet'))
        expect(onNavigate).toHaveBeenCalledWith('landing')
    })

    it('shows 0 of 5 steps completed when no steps met', async () => {
        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        expect(screen.getByText('0 of 5 steps completed')).toBeInTheDocument()
    })
})
