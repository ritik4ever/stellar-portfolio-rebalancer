import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationPreferences from './NotificationPreferences'
import { ApiClientError, ENDPOINTS } from '../config/api'
import { walletManager } from '../utils/walletManager'

// Isolated API doubles. Every network call made by the component under test
// goes through these functions, so no request can reach a real backend.
const apiDoubles = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    downloadPortfolioExport: vi.fn(async () => undefined),
}))

vi.mock('../config/api', async importOriginal => {
    const actual = await importOriginal<typeof import('../config/api')>()
    return {
        ...actual,
        api: {
            get: apiDoubles.get,
            post: apiDoubles.post,
            delete: apiDoubles.delete,
        },
        downloadPortfolioExport: apiDoubles.downloadPortfolioExport,
    }
})

// Isolated wallet double: the settings panel receives its userId from the
// connected wallet exactly as Dashboard does, without touching extensions.
vi.mock('../utils/walletManager', () => ({
    walletManager: {
        getPublicKey: vi.fn(() => 'G-WALLET-USER'),
        isConnected: vi.fn(async () => true),
        disconnect: vi.fn(async () => undefined),
    },
}))

const SAVED_SECRET_URL = 'https://receiver.example/hook?token=saved-secret-111'
const ROTATED_SECRET_URL = 'https://receiver.example/rotated?token=rotated-secret-222'

function webhookPreferences(overrides: Record<string, unknown> = {}) {
    return {
        emailEnabled: false,
        emailAddress: '',
        webhookEnabled: true,
        webhookUrl: SAVED_SECRET_URL,
        telegramEnabled: false,
        telegramChatId: '',
        digestEnabled: false,
        digestFrequency: 'realtime',
        events: {
            rebalance: true,
            circuitBreaker: true,
            priceMovement: true,
            riskChange: true,
        },
        ...overrides,
    }
}

function renderWalletBackedSettings() {
    const userId = walletManager.getPublicKey() ?? ''
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(
        <QueryClientProvider client={client}>
            <NotificationPreferences userId={userId} />
        </QueryClientProvider>
    )
}

describe('Notification webhook settings edge and failure states (SPR-2026-080)', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        apiDoubles.get.mockResolvedValue({ preferences: webhookPreferences() } as any)
        apiDoubles.post.mockResolvedValue({ success: true } as any)
    })

    it('blocks an invalid callback URL, keeps the saved endpoint active, and never exposes the endpoint secret', async () => {
        const { container } = renderWalletBackedSettings()

        const input = await screen.findByLabelText('Callback URL')
        expect(walletManager.getPublicKey).toHaveBeenCalled()
        expect(apiDoubles.get).toHaveBeenCalledWith(ENDPOINTS.NOTIFICATIONS_PREFERENCES, {
            userId: 'G-WALLET-USER',
        })
        expect(input).toHaveAttribute('type', 'password')
        expect(screen.getByText('Saved webhook endpoint active.')).toHaveAttribute('role', 'status')

        const save = screen.getByRole('button', { name: 'Save Preferences' })
        fireEvent.change(input, { target: { value: 'ftp://receiver.example/hook' } })

        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent(
            'Enter a valid callback URL starting with http:// or https://.'
        )
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(input).toHaveAccessibleDescription(/Enter a valid callback URL/)
        expect(save).toBeDisabled()
        expect(apiDoubles.post).not.toHaveBeenCalled()

        // Delivery still uses the saved endpoint even though the edit is invalid,
        // and the endpoint is reported through status text, not its secret URL.
        expect(screen.getByText(/Replacement endpoint pending/)).toHaveTextContent(
            'Delivery uses the saved endpoint until you save.'
        )
        expect(container.textContent).not.toContain(SAVED_SECRET_URL)
        expect(container.textContent).not.toContain('saved-secret-111')
    })

    it('keeps the saved endpoint active on a failed rotation, recovers on retry, and submits at most once per attempt', async () => {
        const user = userEvent.setup()
        let rejectFirstSave!: (reason: unknown) => void
        apiDoubles.post
            .mockImplementationOnce(
                () => new Promise((_, reject) => { rejectFirstSave = reject }) as any
            )
            .mockResolvedValueOnce({ success: true } as any)

        const { container } = renderWalletBackedSettings()
        const input = await screen.findByLabelText('Callback URL')

        fireEvent.change(input, { target: { value: ROTATED_SECRET_URL } })
        const pendingStatus = screen.getByText(/Replacement endpoint pending/)
        expect(pendingStatus).toHaveAttribute('role', 'status')
        expect(pendingStatus).toHaveTextContent(
            'Delivery uses the saved endpoint until you save.'
        )
        expect(container.textContent).not.toContain('rotated-secret-222')

        const save = screen.getByRole('button', { name: 'Save Preferences' })
        await user.click(save)
        expect(await screen.findByText('Saving preferences...')).toBeInTheDocument()

        // Repeat activations while the first save is in flight must not queue
        // a second submission.
        await user.click(save)
        await user.click(save)
        expect(apiDoubles.post).toHaveBeenCalledTimes(1)

        rejectFirstSave(new ApiClientError('Webhook endpoint responded with status 500', 500, 'HTTP_ERROR'))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(
            'Could not save webhook settings. Delivery still uses the previously saved settings.'
        )
        expect(alert).toHaveTextContent('have not been saved')
        // Delivery still uses the previously saved endpoint, and the edited
        // replacement is still pending rather than active.
        expect(screen.getByText(/Replacement endpoint pending/)).toBeInTheDocument()
        expect(apiDoubles.post).toHaveBeenCalledTimes(1)
        expect(container.textContent).not.toContain(SAVED_SECRET_URL)
        expect(container.textContent).not.toContain('saved-secret-111')

        await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

        expect(await screen.findByText('Saved webhook endpoint active.')).toHaveAttribute('role', 'status')
        expect(apiDoubles.post).toHaveBeenCalledTimes(2)
        expect(apiDoubles.post).toHaveBeenLastCalledWith(
            ENDPOINTS.NOTIFICATIONS_SUBSCRIBE,
            expect.objectContaining({ webhookUrl: ROTATED_SECRET_URL })
        )
        expect(screen.queryByRole('alert')).toBeNull()
        // Only the status is shown after rotation; neither secret is rendered.
        expect(container.textContent).not.toContain(ROTATED_SECRET_URL)
        expect(container.textContent).not.toContain('rotated-secret-222')
    })

    it('reports a non-2xx test delivery as an alert, retries once per click, and never shows the callback URL', async () => {
        apiDoubles.post
            .mockRejectedValueOnce(
                new ApiClientError('Webhook endpoint responded with status 502', 502, 'HTTP_ERROR')
            )
            .mockResolvedValueOnce({
                message: 'Test notification sent successfully',
                sentTo: { email: null, webhook: SAVED_SECRET_URL, telegram: null },
                timestamp: '2026-11-25T10:00:00.000Z',
            } as any)

        const { container } = renderWalletBackedSettings()
        const testButton = await screen.findByRole('button', { name: /^test rebalance$/i })

        fireEvent.click(testButton)

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent('Webhook endpoint responded with status 502')
        expect(apiDoubles.post).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: /retry rebalance test/i })).toBeInTheDocument()
        // The saved endpoint status stays visible, and its URL never leaks.
        expect(screen.getByText('Saved webhook endpoint active.')).toHaveAttribute('role', 'status')
        expect(container.textContent).not.toContain(SAVED_SECRET_URL)
        expect(container.textContent).not.toContain('saved-secret-111')

        fireEvent.click(screen.getByRole('button', { name: /retry rebalance test/i }))

        const result = await screen.findByRole('status', { name: /rebalance test result/i })
        expect(result).toHaveTextContent('Test notification sent successfully')
        // Both the endpoint status and the delivery row name the saved endpoint
        // generically, without rendering its URL.
        expect(screen.getAllByText(/Saved webhook endpoint/)).toHaveLength(2)
        expect(apiDoubles.post).toHaveBeenCalledTimes(2)
        expect(apiDoubles.post).toHaveBeenLastCalledWith(ENDPOINTS.NOTIFICATIONS_TEST, {
            userId: 'G-WALLET-USER',
            eventType: 'rebalance',
        })
        expect(container.textContent).not.toContain(SAVED_SECRET_URL)
        expect(container.textContent).not.toContain('saved-secret-111')

        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })
})
