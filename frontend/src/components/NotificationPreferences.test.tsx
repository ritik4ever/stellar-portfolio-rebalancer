import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NotificationPreferences from './NotificationPreferences'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        api: {
            ...actual.api,
            get: getMock,
            post: postMock,
            delete: vi.fn()
        }
    }
})

describe('NotificationPreferences', () => {
    beforeEach(() => {
        getMock.mockReset()
        postMock.mockReset()
        vi.stubGlobal('confirm', vi.fn(() => true))
    })

    it('validates email format and blocks save', async () => {
        getMock.mockResolvedValue({ preferences: null })
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
        vi.useFakeTimers()
        getMock.mockResolvedValue({ preferences: null })
        postMock.mockResolvedValue({ success: true })

        render(<NotificationPreferences userId="user-1" />)
        expect(await screen.findByText('Notifications')).toBeInTheDocument()

        const saveBtn = screen.getByRole('button', { name: /Save Preferences/i })
        const toggles = screen.getAllByRole('button')
        fireEvent.click(toggles[0])

        const emailInput = await screen.findByPlaceholderText(/your-email@example.com/i)
        fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

        expect(saveBtn).toBeEnabled()
        fireEvent.click(saveBtn)

        await waitFor(() => expect(postMock).toHaveBeenCalled())
        expect(await screen.findByText(/Preferences saved successfully/i)).toBeInTheDocument()

        vi.advanceTimersByTime(3000)
        vi.useRealTimers()
    })
})
