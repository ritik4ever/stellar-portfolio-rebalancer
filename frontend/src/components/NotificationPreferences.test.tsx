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

        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])

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
        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])

        const emailInput = await screen.findByPlaceholderText(/your-email@example.com/i)
        fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

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
        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])
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
            })
        })
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

        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])
        fireEvent.change(await screen.findByPlaceholderText(/your-email@example.com/i), {
            target: { value: 'user@example.com' },
        })

        fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))
        expect(await screen.findByText(/saving\.\.\./i)).toBeTruthy()

        resolveSave({ success: true })
        expect(await screen.findByText(/preferences saved successfully/i)).toBeTruthy()
    })

    it('does not trigger mutation when preference is toggled back before save', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)
        renderWithQuery(<NotificationPreferences userId="user-1" />)

        expect(await screen.findByText('Notifications')).toBeTruthy()
        const toggles = screen.getAllByRole('button')
        const saveBtn = screen.getByRole('button', { name: /save preferences/i }) as HTMLButtonElement

        fireEvent.click(toggles[0])
        fireEvent.click(toggles[0])

        expect(saveBtn.disabled).toBe(true)
        fireEvent.click(saveBtn)
        expect(postSpy).not.toHaveBeenCalled()
    })
})
