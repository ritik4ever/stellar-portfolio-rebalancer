import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
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
    const store: Record<string, string> = {}
    const mock = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
        clear: () => { Object.keys(store).forEach(k => delete store[k]) },
        removeItem: (key: string) => { delete store[key] },
        get length() { return Object.keys(store).length },
        key: (i: number) => Object.keys(store)[i] ?? null,
    }
    vi.stubGlobal('localStorage', mock)
    queryClient.clear()
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
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

    it('persists completed items across a simulated remount', async () => {
        localStorage.setItem('onboarding-checklist-completed', JSON.stringify(['connect-wallet', 'create-portfolio']))

        const { unmount } = render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        expect(screen.getByText('2 of 5 steps completed')).toBeInTheDocument()
        expect(screen.getByText('Connect Wallet').closest('button')!.className).toContain('bg-green-50')
        expect(screen.getByText('Create Portfolio').closest('button')!.className).toContain('bg-green-50')

        unmount()

        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        expect(screen.getByText('2 of 5 steps completed')).toBeInTheDocument()
    })

    it('reset progress clears completed items', async () => {
        const user = userEvent.setup()
        localStorage.setItem('onboarding-checklist-completed', JSON.stringify(['connect-wallet', 'create-portfolio', 'set-allocations']))

        render(
            React.createElement(OnboardingChecklist, {
                publicKey: null,
                onNavigate: vi.fn(),
            }),
            { wrapper: Wrapper }
        )

        await screen.findByRole('dialog', { name: /onboarding checklist/i }, { timeout: 2000 })
        expect(screen.getByText('3 of 5 steps completed')).toBeInTheDocument()

        await user.click(screen.getByTitle('Reset onboarding progress'))

        expect(screen.getByText('0 of 5 steps completed')).toBeInTheDocument()
        expect(JSON.parse(localStorage.getItem('onboarding-checklist-completed') || '[]')).toEqual([])
    })
})
