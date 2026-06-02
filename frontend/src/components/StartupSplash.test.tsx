import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StartupSplash from './StartupSplash'

describe('StartupSplash', () => {
    it('shows loading copy while readiness is in flight', () => {
        render(<StartupSplash loading loadError={false} />)
        expect(screen.getByText(/checking backend health/i)).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    })

    it('shows warning copy after a failed readiness check', () => {
        render(<StartupSplash loading={false} loadError />)
        expect(screen.getByText(/warnings/i)).toBeInTheDocument()
    })
})
