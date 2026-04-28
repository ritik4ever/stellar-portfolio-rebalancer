import React, { useEffect, useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConsentGate from './ConsentGate'
import { api } from '../config/api'

const CONSENT_KEY = 'consent:user-1'

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function ConsentHarness({ checkDelayMs = 0 }: { checkDelayMs?: number }) {
    const [resolved, setResolved] = useState(false)
    const [consented, setConsented] = useState(false)

    useEffect(() => {
        const t = setTimeout(() => {
            setConsented(localStorage.getItem(CONSENT_KEY) === 'true')
            setResolved(true)
        }, checkDelayMs)
        return () => clearTimeout(t)
    }, [checkDelayMs])

    if (!resolved) return <div data-testid="consent-checking" />

    if (!consented) {
        return (
            <ConsentGate
                userId="user-1"
                onAccept={() => {
                    localStorage.setItem(CONSENT_KEY, 'true')
                    setConsented(true)
                }}
                onOpenLegal={() => undefined}
            />
        )
    }

    return (
        <div>
            <div>Dashboard Content</div>
            <button
                onClick={() => {
                    localStorage.removeItem(CONSENT_KEY)
                    setConsented(false)
                }}
            >
                Revoke consent
            </button>
        </div>
    )
}

describe('ConsentGate', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
        localStorage.clear()
        vi.spyOn(api, 'post').mockResolvedValue({ accepted: true } as any)
    })

    it('shows consent modal when user has no active consent', async () => {
        renderWithQuery(<ConsentHarness />)
        expect(await screen.findByText(/accept to continue/i)).toBeTruthy()
    })

    it('renders dashboard immediately after consent is granted', async () => {
        renderWithQuery(<ConsentHarness />)

        fireEvent.click((await screen.findAllByRole('checkbox'))[0])
        fireEvent.click(screen.getAllByRole('checkbox')[1])
        fireEvent.click(screen.getAllByRole('checkbox')[2])
        fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))

        expect(await screen.findByText(/dashboard content/i)).toBeTruthy()
        expect(screen.queryByTestId('consent-checking')).toBeNull()
    })

    it('re-shows gate in a new session after consent is revoked', async () => {
        const first = renderWithQuery(<ConsentHarness />)

        fireEvent.click((await screen.findAllByRole('checkbox'))[0])
        fireEvent.click(screen.getAllByRole('checkbox')[1])
        fireEvent.click(screen.getAllByRole('checkbox')[2])
        fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))
        await screen.findByText(/dashboard content/i)

        fireEvent.click(screen.getByRole('button', { name: /revoke consent/i }))
        await screen.findByText(/accept to continue/i)
        first.unmount()

        renderWithQuery(<ConsentHarness />)
        expect(await screen.findByText(/accept to continue/i)).toBeTruthy()
    })

    it('does not flash gate before consent check resolves', async () => {
        vi.useFakeTimers()
        localStorage.setItem(CONSENT_KEY, 'true')
        renderWithQuery(<ConsentHarness checkDelayMs={100} />)

        expect(screen.getByTestId('consent-checking')).toBeTruthy()
        expect(screen.queryByText(/accept to continue/i)).toBeNull()
        expect(screen.queryByText(/dashboard content/i)).toBeNull()

        await act(async () => {
            vi.advanceTimersByTime(100)
            await Promise.resolve()
        })
        expect(screen.getByText(/dashboard content/i)).toBeTruthy()
        vi.useRealTimers()
    })
})
