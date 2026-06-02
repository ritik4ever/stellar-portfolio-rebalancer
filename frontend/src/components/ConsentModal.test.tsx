import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ConsentModal from './ConsentModal'
import { useRecordConsentMutation } from '../hooks/mutations/useConsentMutation'

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
