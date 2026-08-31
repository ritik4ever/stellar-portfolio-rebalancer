import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
})
