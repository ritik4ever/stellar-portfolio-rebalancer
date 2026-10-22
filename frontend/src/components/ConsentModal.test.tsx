import React from 'react'
import { render, screen, fireEvent, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ConsentModal from './ConsentModal'
import { useRecordConsentMutation } from '../hooks/mutations/useConsentMutation'
import { api, ENDPOINTS } from '../config/api'

vi.mock('../hooks/mutations/useConsentMutation', () => ({
    useRecordConsentMutation: vi.fn()
}))

describe('ConsentModal', () => {
    const mockMutateAsync = vi.fn()
    const mockOnAccept = vi.fn()
    const mockOnOpenLegal = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        // @ts-ignore
        useRecordConsentMutation.mockReturnValue({
            mutateAsync: mockMutateAsync,
            isPending: false
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('disables submit button initially', () => {
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        expect(screen.getByRole('button', { name: /accept and continue/i })).toBeDisabled()
    })

    it('enables submit button when all checkboxes are checked', () => {
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(checkboxes[2])
        expect(screen.getByRole('button', { name: /accept and continue/i })).toBeEnabled()
    })

    it('ensures each toggle can change without affecting the other', () => {
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const analyticsToggle = screen.getByTestId('consent-analytics-toggle')
        const marketingToggle = screen.getByTestId('consent-marketing-toggle')

        // Initial state: both toggles are false
        expect(analyticsToggle).not.toBeChecked()
        expect(marketingToggle).not.toBeChecked()

        // Toggle analytics ON -> analytics is true, marketing remains false
        fireEvent.click(analyticsToggle)
        expect(analyticsToggle).toBeChecked()
        expect(marketingToggle).not.toBeChecked()

        // Toggle marketing ON -> both are true
        fireEvent.click(marketingToggle)
        expect(analyticsToggle).toBeChecked()
        expect(marketingToggle).toBeChecked()

        // Toggle analytics OFF -> analytics is false, marketing remains true
        fireEvent.click(analyticsToggle)
        expect(analyticsToggle).not.toBeChecked()
        expect(marketingToggle).toBeChecked()

        // Toggle marketing OFF -> both are false
        fireEvent.click(marketingToggle)
        expect(analyticsToggle).not.toBeChecked()
        expect(marketingToggle).not.toBeChecked()
    })

    it('submits analytics=true, marketing=false when only analytics is toggled on', async () => {
        mockMutateAsync.mockResolvedValue(undefined)
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(checkboxes[2])
        fireEvent.click(checkboxes[3]) // analytics
        fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))
        expect(mockMutateAsync).toHaveBeenCalledWith({ analytics: true, marketing: false })
    })

    it('submits marketing=true, analytics=false when only marketing is toggled on', async () => {
        mockMutateAsync.mockResolvedValue(undefined)
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(checkboxes[2])
        fireEvent.click(checkboxes[4]) // marketing
        fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))
        expect(mockMutateAsync).toHaveBeenCalledWith({ analytics: false, marketing: true })
    })

    it('submits both analytics and marketing independently when both are toggled on', async () => {
        mockMutateAsync.mockResolvedValue(undefined)
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(checkboxes[2])
        fireEvent.click(checkboxes[3]) // analytics
        fireEvent.click(checkboxes[4]) // marketing
        fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))
        expect(mockMutateAsync).toHaveBeenCalledWith({ analytics: true, marketing: true })
    })

    it('defaults analytics and marketing to false when neither is toggled', async () => {
        mockMutateAsync.mockResolvedValue(undefined)
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(checkboxes[2])
        fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))
        expect(mockMutateAsync).toHaveBeenCalledWith({ analytics: false, marketing: false })
    })

    it('disables checkboxes and submit button while submitting', () => {
        // @ts-ignore
        useRecordConsentMutation.mockReturnValue({
            mutateAsync: mockMutateAsync,
            isPending: true
        })
        render(<ConsentModal userId="user1" onAccept={mockOnAccept} onOpenLegal={mockOnOpenLegal} />)
        const checkboxes = screen.getAllByRole('checkbox')
        checkboxes.forEach(cb => expect(cb).toBeDisabled())
        expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeDisabled()
    })
})

describe('Consent API payload integration', () => {
    it('submits the correct category-specific payload to the backend consent API', async () => {
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ accepted: true })
        const { useRecordConsentMutation: actualHook } = await vi.importActual<
            typeof import('../hooks/mutations/useConsentMutation')
        >('../hooks/mutations/useConsentMutation')

        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
        })

        const { result } = renderHook(() => actualHook('user-456'), {
            wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        })

        // 1. Accept analytics, decline marketing
        await result.current.mutateAsync({ analytics: true, marketing: false })
        expect(postSpy).toHaveBeenLastCalledWith(
            ENDPOINTS.CONSENT_RECORD,
            {
                userId: 'user-456',
                terms: true,
                privacy: true,
                cookies: true,
                analytics: true,
                marketing: false,
            }
        )

        // 2. Decline analytics, accept marketing
        await result.current.mutateAsync({ analytics: false, marketing: true })
        expect(postSpy).toHaveBeenLastCalledWith(
            ENDPOINTS.CONSENT_RECORD,
            {
                userId: 'user-456',
                terms: true,
                privacy: true,
                cookies: true,
                analytics: false,
                marketing: true,
            }
        )

        // 3. Accept both
        await result.current.mutateAsync({ analytics: true, marketing: true })
        expect(postSpy).toHaveBeenLastCalledWith(
            ENDPOINTS.CONSENT_RECORD,
            {
                userId: 'user-456',
                terms: true,
                privacy: true,
                cookies: true,
                analytics: true,
                marketing: true,
            }
        )

        // 4. Default when neither is provided
        await result.current.mutateAsync({})
        expect(postSpy).toHaveBeenLastCalledWith(
            ENDPOINTS.CONSENT_RECORD,
            {
                userId: 'user-456',
                terms: true,
                privacy: true,
                cookies: true,
                analytics: false,
                marketing: false,
            }
        )
    })
})
