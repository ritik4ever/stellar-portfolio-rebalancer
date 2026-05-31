import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotificationTest } from './NotificationTest'
import { api } from '../config/api'

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('NotificationTest', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    // ── Empty state ──────────────────────────────────────────────────────────

    it('shows empty state when no provider is configured', () => {
        renderWithQuery(<NotificationTest userId="user-1" hasConfiguredProvider={false} />)

        expect(
            screen.getByRole('status', { name: /notification test unavailable/i })
        ).toBeTruthy()
        expect(screen.queryByRole('button', { name: /test all/i })).toBeNull()
    })

    it('shows the test UI when a provider is configured', () => {
        renderWithQuery(<NotificationTest userId="user-1" hasConfiguredProvider={true} />)

        expect(screen.getByRole('button', { name: /test all notification types/i })).toBeTruthy()
        expect(screen.getByRole('list', { name: /individual notification tests/i })).toBeTruthy()
    })

    // ── Individual test ──────────────────────────────────────────────────────

    it('shows loading state while a single test is in flight', async () => {
        let resolve!: (v: any) => void
        vi.spyOn(api, 'post').mockImplementation(
            () => new Promise(res => { resolve = res }) as any
        )

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /^test rebalance$/i }))

        expect(await screen.findByRole('button', { name: /^test rebalance$/i })).toBeTruthy()
        // The button label changes to "Testing…" while in flight
        expect(screen.getByText(/testing…/i)).toBeTruthy()

        resolve({ message: 'Sent', sentTo: { email: 'a@b.com', webhook: null }, timestamp: new Date().toISOString() })
    })

    it('displays inline success result after a successful single test', async () => {
        vi.spyOn(api, 'post').mockResolvedValue({
            message: 'Test notification sent successfully',
            sentTo: { email: 'user@example.com', webhook: null },
            timestamp: '2026-01-01T12:00:00.000Z',
        } as any)

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /^test rebalance$/i }))

        expect(await screen.findByText(/test notification sent successfully/i)).toBeTruthy()
        expect(await screen.findByText(/user@example\.com/i)).toBeTruthy()
    })

    it('displays inline failure result and shows Retry button on error', async () => {
        vi.spyOn(api, 'post').mockRejectedValue(new Error('SMTP connection refused'))

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /^test rebalance$/i }))

        expect(await screen.findByText(/smtp connection refused/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /retry rebalance test/i })).toBeTruthy()
    })

    it('shows webhook delivery destination when webhook is configured', async () => {
        vi.spyOn(api, 'post').mockResolvedValue({
            message: 'Sent',
            sentTo: { email: null, webhook: 'https://hooks.example.com/notify' },
            timestamp: new Date().toISOString(),
        } as any)

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /^test circuit breaker$/i }))

        expect(await screen.findByText(/https:\/\/hooks\.example\.com\/notify/i)).toBeTruthy()
    })

    it('shows Re-test label after a result is already present', async () => {
        vi.spyOn(api, 'post').mockResolvedValue({
            message: 'Sent',
            sentTo: { email: 'a@b.com', webhook: null },
            timestamp: new Date().toISOString(),
        } as any)

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /^test rebalance$/i }))

        expect(await screen.findByRole('button', { name: /re-test rebalance/i })).toBeTruthy()
    })

    // ── Test-all ─────────────────────────────────────────────────────────────

    it('shows loading state while test-all is in flight', async () => {
        let resolve!: (v: any) => void
        vi.spyOn(api, 'post').mockImplementation(
            () => new Promise(res => { resolve = res }) as any
        )

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /test all notification types/i }))

        expect(await screen.findByText(/testing all…/i)).toBeTruthy()

        resolve({ results: [] })
    })

    it('populates all event results after test-all succeeds', async () => {
        const ts = new Date().toISOString()
        vi.spyOn(api, 'post').mockResolvedValue({
            results: [
                { eventType: 'rebalance', success: true, sentTo: { email: 'u@e.com', webhook: null }, timestamp: ts },
                { eventType: 'circuitBreaker', success: true, sentTo: { email: 'u@e.com', webhook: null }, timestamp: ts },
                { eventType: 'priceMovement', success: false, error: 'Timeout', sentTo: null, timestamp: ts },
                { eventType: 'riskChange', success: true, sentTo: { email: 'u@e.com', webhook: null }, timestamp: ts },
            ],
        } as any)

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /test all notification types/i }))

        // Success results show the message
        expect(await screen.findAllByText(/test notification sent/i)).toHaveLength(3)
        // Failure result shows the error
        expect(await screen.findByText(/timeout/i)).toBeTruthy()
    })

    it('shows a top-level error banner when test-all fails entirely', async () => {
        vi.spyOn(api, 'post').mockRejectedValue(new Error('Network error'))

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /test all notification types/i }))

        expect(await screen.findByRole('alert')).toBeTruthy()
        expect(await screen.findByText(/network error/i)).toBeTruthy()
    })

    // ── Clear results ────────────────────────────────────────────────────────

    it('clears all results when Clear results is clicked', async () => {
        vi.spyOn(api, 'post').mockResolvedValue({
            message: 'Sent',
            sentTo: { email: 'a@b.com', webhook: null },
            timestamp: new Date().toISOString(),
        } as any)

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /^test rebalance$/i }))
        await screen.findByRole('button', { name: /re-test rebalance/i })

        fireEvent.click(screen.getByRole('button', { name: /clear all test results/i }))

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /re-test rebalance/i })).toBeNull()
        })
    })

    // ── Accessibility ────────────────────────────────────────────────────────

    it('disables individual test buttons while test-all is running', async () => {
        let resolve!: (v: any) => void
        vi.spyOn(api, 'post').mockImplementation(
            () => new Promise(res => { resolve = res }) as any
        )

        renderWithQuery(<NotificationTest userId="user-1" />)

        fireEvent.click(screen.getByRole('button', { name: /test all notification types/i }))

        await waitFor(() => {
            const testBtn = screen.getByRole('button', { name: /^test rebalance$/i })
            expect((testBtn as HTMLButtonElement).disabled).toBe(true)
        })

        resolve({ results: [] })
    })
})
