import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationPreferences from './NotificationPreferences'
import { api, ENDPOINTS } from '../config/api'

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const getEmailSwitch = () => screen.getByRole('switch', { name: /email notifications/i })

describe('NotificationPreferences', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
        vi.stubGlobal('confirm', vi.fn(() => true))
    })

    it('validates and masks a rotated webhook URL, keeping saved status until save succeeds', async () => {
        const oldUrl = 'https://receiver.example/old?token=first-secret'
        const newUrl = 'https://receiver.example/new?token=second-secret'
        const preferences = {
            emailEnabled: false, emailAddress: '', webhookEnabled: true, webhookUrl: oldUrl,
            telegramEnabled: false, telegramChatId: '', digestEnabled: false, digestFrequency: 'realtime',
            events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
        }
        vi.spyOn(api, 'get').mockImplementation(async () => ({ preferences }) as any)
        const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error(newUrl))
            .mockImplementationOnce(async () => {
                preferences.webhookUrl = newUrl
                return { success: true } as any
            })
        renderWithQuery(<NotificationPreferences userId="user-1" />)
        const input = await screen.findByLabelText('Callback URL')
        const save = screen.getByRole('button', { name: 'Save Preferences' })
        expect(input).toHaveAttribute('type', 'password')
        expect(screen.getByText('Saved webhook endpoint active.')).toBeInTheDocument()

        fireEvent.change(input, { target: { value: 'ftp://receiver.example' } })
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(input).toHaveAccessibleDescription(/Enter a valid callback URL/)
        expect(save).toBeDisabled()
        expect(post).not.toHaveBeenCalled()

        fireEvent.change(input, { target: { value: newUrl } })
        expect(screen.getByText(/Delivery uses the saved endpoint until you save/)).toBeInTheDocument()
        fireEvent.click(save)
        expect(await screen.findByText(/Delivery still uses the previously saved settings/)).toBeInTheDocument()
        expect(screen.queryByText(newUrl)).toBeNull()
        fireEvent.click(save)
        expect(await screen.findByText('Saved webhook endpoint active.')).toBeInTheDocument()
        expect(post).toHaveBeenLastCalledWith(ENDPOINTS.NOTIFICATIONS_SUBSCRIBE, expect.objectContaining({ webhookUrl: newUrl }))
        expect(screen.queryByText(/first-secret|second-secret/)).toBeNull()
    })

    it('validates email format and blocks save', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(getEmailSwitch())

        const emailInput = await screen.findByPlaceholderText(/your-email@example.com/i)
        fireEvent.change(emailInput, { target: { value: 'bad-email' } })

        expect(await screen.findByText(/Invalid email address format/i)).toBeTruthy()
        expect((screen.getByRole('button', { name: /Save Preferences/i }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('allows saving with all notification channels disabled and disables test delivery', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({
            preferences: {
                emailEnabled: true,
                emailAddress: 'user@example.com',
                webhookEnabled: false,
                webhookUrl: '',
                telegramEnabled: false,
                telegramChatId: '',
                events: {
                    rebalance: true,
                    circuitBreaker: true,
                    priceMovement: true,
                    riskChange: true,
                },
                digestEnabled: false,
                digestFrequency: 'realtime',
            },
        } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()
        expect(screen.getByText(/1 of 3 notification channels enabled: Email only/i)).toBeTruthy()

        fireEvent.click(getEmailSwitch())
        expect(screen.getByText(/0 of 3 notification channels enabled/i)).toBeTruthy()
        expect(screen.getByText(/Changes take effect after saving; test delivery uses saved settings until then/i)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

        await waitFor(() => {
            expect(postSpy).toHaveBeenCalledWith(
                ENDPOINTS.NOTIFICATIONS_SUBSCRIBE,
                expect.objectContaining({
                    emailEnabled: false,
                    webhookEnabled: false,
                    telegramEnabled: false,
                })
            )
        })
        expect(await screen.findByText(/Save at least one notification provider/i)).toBeTruthy()
    })

    it('shows required-field validation when the only enabled channel is missing its address', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(getEmailSwitch())
        expect(screen.getByText(/1 of 3 notification channels enabled: Email only/i)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

        expect(await screen.findByText(/Email address is required when email notifications are enabled/i)).toBeTruthy()
        expect(postSpy).not.toHaveBeenCalled()
    })

    it('shows required-field validation immediately when clearing an enabled email and clears it when disabled', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({
            preferences: {
                emailEnabled: true,
                emailAddress: 'user@example.com',
                webhookEnabled: false,
                webhookUrl: '',
                telegramEnabled: false,
                telegramChatId: '',
                events: {
                    rebalance: true,
                    circuitBreaker: true,
                    priceMovement: true,
                    riskChange: true,
                },
                digestEnabled: false,
                digestFrequency: 'realtime',
            },
        } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        const emailInput = await screen.findByLabelText('Email Address')
        const saveBtn = screen.getByRole('button', { name: /save preferences/i })

        expect(emailInput).toHaveAttribute('aria-required', 'true')
        fireEvent.change(emailInput, { target: { value: '' } })

        expect(screen.getByRole('alert')).toHaveTextContent(/Email address is required when email notifications are enabled/i)
        expect(emailInput).toHaveAttribute('aria-invalid', 'true')
        expect(saveBtn).toBeDisabled()

        fireEvent.click(getEmailSwitch())
        expect(screen.getByText(/0 of 3 notification channels enabled/i)).toBeTruthy()
        expect(saveBtn).not.toBeDisabled()

        fireEvent.click(saveBtn)
        await waitFor(() => expect(postSpy).toHaveBeenCalled())
    })

    it('validates Telegram Chat ID when Telegram is the only enabled channel and blocks save when blank', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(screen.getByRole('switch', { name: /telegram notifications/i }))
        expect(screen.getByText(/1 of 3 notification channels enabled: Telegram only/i)).toBeTruthy()

        const telegramInput = screen.getByLabelText('Telegram Chat ID')
        const saveBtn = screen.getByRole('button', { name: /save preferences/i })
        expect(telegramInput).toHaveAttribute('aria-required', 'true')

        fireEvent.change(telegramInput, { target: { value: '   ' } })
        expect(screen.getByRole('alert')).toHaveTextContent(/Telegram Chat ID is required/i)
        expect(telegramInput).toHaveAttribute('aria-invalid', 'true')
        expect(saveBtn).toBeDisabled()
        expect(postSpy).not.toHaveBeenCalled()

        fireEvent.change(telegramInput, { target: { value: '123456789' } })
        expect(saveBtn).not.toBeDisabled()
        fireEvent.click(saveBtn)

        await waitFor(() => {
            expect(postSpy).toHaveBeenCalledWith(
                ENDPOINTS.NOTIFICATIONS_SUBSCRIBE,
                expect.objectContaining({
                    emailEnabled: false,
                    webhookEnabled: false,
                    telegramEnabled: true,
                    telegramChatId: '123456789',
                })
            )
        })
    })

    it('saves preferences successfully', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        const saveBtn = screen.getByRole('button', { name: /Save Preferences/i })
        fireEvent.click(getEmailSwitch())

        const emailInput = await screen.findByPlaceholderText(/your-email@example.com/i)
        fireEvent.change(emailInput, { target: { value: 'user@example.com' } })
        expect(screen.getByText(/Email notification changes are pending save/i)).toBeTruthy()

        expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
        fireEvent.click(saveBtn)

        await waitFor(() => expect(postSpy).toHaveBeenCalled())
        expect(await screen.findByText(/Preferences saved successfully/i)).toBeTruthy()
    })

    it('retries a failed save with the current draft without submitting twice', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        let resolveRetry!: (value: any) => void
        const postSpy = vi.spyOn(api, 'post')
            .mockRejectedValueOnce(new Error('Network unavailable'))
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveRetry = resolve
            }) as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(getEmailSwitch())
        fireEvent.change(await screen.findByPlaceholderText(/your-email@example.com/i), {
            target: { value: 'user@example.com' },
        })
        fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

        await screen.findByRole('button', { name: 'Retry save' })
        fireEvent.click(screen.getByRole('switch', { name: /risk level change alerts/i }))
        const retryButton = screen.getByRole('button', { name: 'Retry save' })
        expect(retryButton).toBeEnabled()
        fireEvent.click(retryButton)
        fireEvent.click(retryButton)
        expect(await screen.findByText(/Saving notification preferences/i)).toBeInTheDocument()

        expect(postSpy).toHaveBeenCalledTimes(2)
        expect(postSpy).toHaveBeenLastCalledWith(
            ENDPOINTS.NOTIFICATIONS_SUBSCRIBE,
            expect.objectContaining({
                emailEnabled: true,
                emailAddress: 'user@example.com',
                events: expect.objectContaining({ riskChange: false }),
            })
        )

        resolveRetry({ success: true })
        expect(await screen.findByText(/Preferences saved successfully/i)).toBeTruthy()
        expect(postSpy).toHaveBeenCalledTimes(2)
    })

    it('calls mutation with correct payload when email preference is toggled', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        expect(await screen.findByText('Notifications')).toBeTruthy()
        fireEvent.click(getEmailSwitch())
        fireEvent.change(await screen.findByPlaceholderText(/your-email@example.com/i), {
            target: { value: 'user@example.com' },
        })

        fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

        await waitFor(() => {
            expect(postSpy).toHaveBeenCalledWith(ENDPOINTS.NOTIFICATIONS_SUBSCRIBE, {
                userId: 'user-1',
                emailEnabled: true,
                emailAddress: 'user@example.com',
                webhookEnabled: false,
                webhookUrl: '',
                telegramEnabled: false,
                telegramChatId: '',
                events: {
                    rebalance: true,
                    circuitBreaker: true,
                    priceMovement: true,
                    riskChange: true,
                },
                digestEnabled: false,
                digestFrequency: 'realtime',
            })
        })
    })

    it('allows saving unrelated changes when a disabled email channel has a stale invalid address', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(getEmailSwitch())
        fireEvent.change(await screen.findByPlaceholderText(/your-email@example.com/i), {
            target: { value: 'bad-email' },
        })
        fireEvent.click(getEmailSwitch())
        fireEvent.click(screen.getByRole('switch', { name: /risk level change alerts/i }))

        const saveBtn = screen.getByRole('button', { name: /save preferences/i }) as HTMLButtonElement
        expect(saveBtn.disabled).toBe(false)
        fireEvent.click(saveBtn)

        await waitFor(() => expect(postSpy).toHaveBeenCalled())
    })

    it('shows loading state during save and success toast after completion', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        let resolveSave!: (value: any) => void
        vi.spyOn(api, 'post').mockImplementation(
            () =>
                new Promise(res => {
                    resolveSave = res
                }) as any
        )

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(getEmailSwitch())
        fireEvent.change(await screen.findByPlaceholderText(/your-email@example.com/i), {
            target: { value: 'user@example.com' },
        })

        fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))
        expect(await screen.findByText(/saving preferences/i)).toBeTruthy()
        expect(screen.getByText(/saving notification preferences/i)).toBeTruthy()
        expect(screen.getByText(/saving email notification settings/i)).toBeTruthy()

        resolveSave({ success: true })
        expect(await screen.findByText(/preferences saved successfully/i)).toBeTruthy()
    })

    it('does not trigger mutation when preference is toggled back before save', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        expect(await screen.findByText('Notifications')).toBeTruthy()
        const saveBtn = screen.getByRole('button', { name: /save preferences/i }) as HTMLButtonElement

        fireEvent.click(getEmailSwitch())
        fireEvent.click(getEmailSwitch())

        expect(saveBtn.disabled).toBe(true)
        fireEvent.click(saveBtn)
        expect(postSpy).not.toHaveBeenCalled()
    })

    it('shows a distinct unsubscribe pending and success state', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({
            preferences: {
                emailEnabled: true,
                emailAddress: 'user@example.com',
                webhookEnabled: false,
                webhookUrl: '',
                events: {
                    rebalance: true,
                    circuitBreaker: true,
                    priceMovement: true,
                    riskChange: true,
                },
                digestEnabled: false,
                digestFrequency: 'realtime',
            },
        } as any)
        let resolveUnsubscribe!: (value: any) => void
        vi.spyOn(api, 'delete').mockImplementation(
            () =>
                new Promise(res => {
                    resolveUnsubscribe = res
                }) as any
        )

        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: /unsubscribe from all/i }))
        fireEvent.click(screen.getByRole('button', { name: /skip and unsubscribe/i }))

        expect(await screen.findByText(/unsubscribing from notifications/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /unsubscribing/i })).toBeDisabled()

        resolveUnsubscribe({ success: true })

        expect(await screen.findByText(/unsubscribed from all notifications/i)).toBeTruthy()
    })

    // ── Accessibility: webhook settings (SPR-2026-078) ────────────────────

    const webhookPreferences = {
        emailEnabled: false, emailAddress: '', webhookEnabled: true, webhookUrl: 'https://receiver.example/hook',
        telegramEnabled: false, telegramChatId: '', digestEnabled: false, digestFrequency: 'realtime',
        events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
    }

    it('announces an invalid callback URL as an alert described by the field', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: { ...webhookPreferences } } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        const input = await screen.findByLabelText('Callback URL')
        fireEvent.change(input, { target: { value: 'not a url' } })

        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent('Enter a valid callback URL starting with http:// or https://.')
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    })

    it('announces endpoint rotation state in a live region', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: { ...webhookPreferences } } as any)
        const post = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        const input = await screen.findByLabelText('Callback URL')
        expect(screen.getByText('Saved webhook endpoint active.')).toHaveAttribute('role', 'status')

        fireEvent.change(input, { target: { value: 'https://receiver.example/rotated' } })
        const pendingStatus = screen.getByText(/Replacement endpoint pending/)
        expect(pendingStatus).toHaveAttribute('role', 'status')
        expect(pendingStatus).toHaveTextContent('Delivery uses the saved endpoint until you save.')

        fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))
        expect(await screen.findByText('Saved webhook endpoint active.')).toHaveAttribute('role', 'status')
        expect(post).toHaveBeenCalled()
    })

    it('gives the email and telegram fields accessible names and described errors', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeTruthy()

        fireEvent.click(getEmailSwitch())
        const emailInput = screen.getByLabelText('Email Address')
        fireEvent.change(emailInput, { target: { value: 'bad-email' } })
        expect(emailInput).toHaveAttribute('aria-invalid', 'true')
        expect(emailInput).toHaveAccessibleDescription(/Invalid email address format/)

        fireEvent.click(screen.getByRole('switch', { name: /telegram notifications/i }))
        const telegramInput = screen.getByLabelText('Telegram Chat ID')
        fireEvent.change(telegramInput, { target: { value: '123456' } })
        fireEvent.change(telegramInput, { target: { value: '' } })
        expect(telegramInput).toHaveAttribute('aria-invalid', 'true')
        expect(telegramInput).toHaveAccessibleDescription(/Telegram Chat ID is required/)
    })

    it('moves focus into the unsubscribe dialog and returns it to the trigger on Cancel', async () => {
        const user = userEvent.setup()
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: { ...webhookPreferences } } as any)
        vi.spyOn(api, 'delete').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        const trigger = await screen.findByRole('button', { name: /unsubscribe from all/i })
        await user.click(trigger)

        const dialog = screen.getByRole('dialog', { name: /before you unsubscribe/i })
        expect(dialog.contains(document.activeElement)).toBe(true)

        await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(trigger).toHaveFocus()
    })

    it('abandons the unsubscribe dialog with Escape and returns focus without unsubscribing', async () => {
        const user = userEvent.setup()
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: { ...webhookPreferences } } as any)
        const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        const trigger = await screen.findByRole('button', { name: /unsubscribe from all/i })
        await user.click(trigger)
        expect(screen.getByRole('dialog')).toBeInTheDocument()

        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(trigger).toHaveFocus()
        expect(deleteSpy).not.toHaveBeenCalled()
    })

    it('keeps Tab navigation inside the unsubscribe dialog', async () => {
        const user = userEvent.setup()
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: { ...webhookPreferences } } as any)
        vi.spyOn(api, 'delete').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        const trigger = await screen.findByRole('button', { name: /unsubscribe from all/i })
        await user.click(trigger)

        const dialog = screen.getByRole('dialog')
        const cancel = within(dialog).getByRole('button', { name: /^cancel$/i })
        const reason = within(dialog).getByLabelText(/reason \(optional\)/i)
        const skip = within(dialog).getByRole('button', { name: /skip and unsubscribe/i })
        const confirm = within(dialog).getByRole('button', { name: /^unsubscribe$/i })

        await user.tab()
        expect(cancel).toHaveFocus()
        await user.tab()
        expect(reason).toHaveFocus()
        await user.tab()
        expect(skip).toHaveFocus()
        await user.tab()
        expect(confirm).toHaveFocus()
        // Tab on the last control wraps to the first instead of leaving the dialog
        await user.tab()
        expect(cancel).toHaveFocus()
        // Shift+Tab on the first control wraps to the last
        await user.tab({ shift: true })
        expect(confirm).toHaveFocus()
    })

    it('lets a keyboard user complete the unsubscribe flow from the dialog', async () => {
        const user = userEvent.setup()
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: { ...webhookPreferences } } as any)
        const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        const trigger = await screen.findByRole('button', { name: /unsubscribe from all/i })
        trigger.focus()
        await user.keyboard('{Enter}')
        const dialog = screen.getByRole('dialog')
        expect(dialog.contains(document.activeElement)).toBe(true)

        await user.click(within(dialog).getByRole('button', { name: /skip and unsubscribe/i }))
        expect(await screen.findByText(/unsubscribed from all notifications/i)).toBeTruthy()
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(deleteSpy).toHaveBeenCalled()
    })

    // ── Responsive layout: 320px viewport & 200% text sizing (SPR-2026-079) ──

    describe('webhook settings at 320px viewport and 200% text sizing', () => {
        const originalInnerWidth = window.innerWidth
        const originalFontSize = document.documentElement.style.fontSize

        beforeEach(() => {
            Object.defineProperty(window, 'innerWidth', {
                writable: true,
                configurable: true,
                value: 320,
            })
            document.documentElement.style.fontSize = '200%'
        })

        afterEach(() => {
            Object.defineProperty(window, 'innerWidth', {
                writable: true,
                configurable: true,
                value: originalInnerWidth,
            })
            document.documentElement.style.fontSize = originalFontSize
        })

        it('keeps webhook controls and endpoint status visible, wrapping, and operable without exposing secrets', async () => {
            const secretUrl = 'https://receiver.example/hook?token=super-secret-value-12345'
            const rotatedSecretUrl = 'https://receiver.example/rotated?token=another-secret-67890'
            vi.spyOn(api, 'get').mockResolvedValue({
                preferences: { ...webhookPreferences, webhookUrl: secretUrl },
            } as any)
            const post = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

            const { container } = renderWithQuery(<NotificationPreferences userId="user-1" />)

            const webhookSwitch = await screen.findByRole('switch', { name: /webhook notifications/i })
            const callbackInput = screen.getByLabelText('Callback URL')
            const status = screen.getByText('Saved webhook endpoint active.')
            const saveButton = screen.getByRole('button', { name: 'Save Preferences' })

            // Controls and status remain visible and use wrapping/shrinking classes to prevent horizontal clipping
            expect(webhookSwitch).toBeVisible()
            expect(webhookSwitch.className).toContain('flex-shrink-0')
            expect(webhookSwitch.parentElement?.className).toContain('flex-wrap')

            expect(status).toBeVisible()
            expect(status.className).toContain('break-words')

            expect(callbackInput).toBeVisible()
            expect(callbackInput).toHaveAttribute('type', 'password')
            expect(callbackInput.className).toContain('w-full')
            expect(callbackInput.className).toContain('min-w-0')

            expect(saveButton).toBeVisible()
            expect(saveButton.className).toContain('w-full')
            expect(saveButton.className).toContain('flex-wrap')

            // Secret token is never exposed in rendered text content
            expect(container.textContent).not.toContain('super-secret-value-12345')
            expect(container.textContent).not.toContain(secretUrl)

            // Invalid URL state remains visible with wrapping error alert
            fireEvent.change(callbackInput, { target: { value: 'invalid-url' } })
            const alert = screen.getByRole('alert')
            expect(alert).toBeVisible()
            expect(alert.className).toContain('break-words')
            expect(saveButton).toBeDisabled()

            // Rotating to a valid URL keeps status visible without exposing the new secret and allows saving
            fireEvent.change(callbackInput, { target: { value: rotatedSecretUrl } })
            const pendingStatus = screen.getByText(/Replacement endpoint pending/)
            expect(pendingStatus).toBeVisible()
            expect(pendingStatus.className).toContain('break-words')
            expect(container.textContent).not.toContain('another-secret-67890')
            expect(saveButton).not.toBeDisabled()

            fireEvent.click(saveButton)
            expect(await screen.findByText('Saved webhook endpoint active.')).toBeVisible()
            expect(post).toHaveBeenCalledWith(
                ENDPOINTS.NOTIFICATIONS_SUBSCRIBE,
                expect.objectContaining({ webhookUrl: rotatedSecretUrl })
            )
            expect(container.textContent).not.toContain('another-secret-67890')
        })

        it('keeps webhook delivery off state and save failure banner readable without horizontal clipping', async () => {
            vi.spyOn(api, 'get').mockResolvedValue({
                preferences: { ...webhookPreferences, webhookEnabled: false, webhookUrl: '' },
            } as any)
            vi.spyOn(api, 'post').mockRejectedValue(new Error('Network error'))

            renderWithQuery(<NotificationPreferences userId="user-1" />)

            const offStatus = await screen.findByText('Webhook delivery is off.')
            expect(offStatus).toBeVisible()
            expect(offStatus.className).toContain('break-words')

            const webhookSwitch = screen.getByRole('switch', { name: /webhook notifications/i })
            fireEvent.click(webhookSwitch)

            const callbackInput = screen.getByLabelText('Callback URL')
            fireEvent.change(callbackInput, { target: { value: 'https://receiver.example/new-hook' } })
            fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))

            const errorAlert = await screen.findByRole('alert')
            expect(errorAlert).toBeVisible()
            expect(errorAlert.className).toContain('min-w-0')
            expect(errorAlert).toHaveTextContent(
                'Could not save webhook settings. Delivery still uses the previously saved settings.'
            )
        })
    })
})
