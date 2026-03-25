import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import NotificationPreferences from './NotificationPreferences'
import { api } from '../config/api'

describe('NotificationPreferences', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
        vi.stubGlobal('confirm', vi.fn(() => true))
    })

    it('validates email format and blocks save', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        render(<NotificationPreferences userId="user-1" />)

        expect(await screen.findByText('Notifications')).toBeInTheDocument()

        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])

        const emailInput = await screen.findByPlaceholderText(/your-email@example.com/i)
        fireEvent.change(emailInput, { target: { value: 'bad-email' } })

        expect(await screen.findByText(/Invalid email address format/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Save Preferences/i })).toBeDisabled()
    })

    it('saves preferences successfully', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ preferences: null } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ success: true } as any)

        render(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeInTheDocument()

        const saveBtn = screen.getByRole('button', { name: /Save Preferences/i })
        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])

        const emailInput = await screen.findByPlaceholderText(/your-email@example.com/i)
        fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

        expect(saveBtn).toBeEnabled()
        fireEvent.click(saveBtn)

        await waitFor(() => expect(postSpy).toHaveBeenCalled())
        expect(await screen.findByText(/Preferences saved successfully/i)).toBeInTheDocument()
    })
})
