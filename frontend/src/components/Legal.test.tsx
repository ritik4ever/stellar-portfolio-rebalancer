import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Legal from './Legal'
import { formatLegalVersionLabel } from '../content/legalMetadata'

describe('Legal', () => {
    it('shows version metadata for terms', () => {
        render(<Legal doc="terms" onBack={vi.fn()} />)
        expect(screen.getByTestId('legal-version-meta')).toHaveTextContent(formatLegalVersionLabel())
        expect(screen.getByTestId('legal-effective-date')).toHaveTextContent('Effective')
    })
})
