import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationPreferences from './NotificationPreferences'
import { api } from '../config/api'

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
})
