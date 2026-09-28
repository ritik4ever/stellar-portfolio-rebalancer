import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import SystemStatusPanel, { type PublicStatusReport } from './SystemStatusPanel'

vi.mock('../config/api', () => ({
    api: { get: vi.fn() },
    ENDPOINTS: { STATUS: '/api/v1/status' },
}))

import { api } from '../config/api'

const getMock = api.get as unknown as ReturnType<typeof vi.fn>

function check(
    status: 'ok' | 'degraded' | 'down',
    overrides: Partial<PublicStatusReport['checks']['reflector_oracle']> = {},
) {
    return {
        status,
        last_checked: '2026-01-01T12:34:50.000Z',
        latency_ms: 42,
        reason: status,
        message: `${status} message`,
        ...overrides,
    }
}

function report(overrides: Partial<PublicStatusReport> = {}): PublicStatusReport {
    return {
        status: 'healthy',
        timestamp: '2026-01-01T12:34:56.000Z',
        checks: {
            reflector_oracle: check('ok', {
                reason: 'ok',
                message: 'Reflector oracle is reachable and serving fresh quotes.',
                latency_ms: 42,
            }),
            stellar_dex: check('ok', {
                reason: 'ok',
                message: 'Stellar DEX is reachable and quoting the probed pair.',
                latency_ms: 61,
            }),
        },
        cache: { cached: false, age_ms: 0, ttl_ms: 15000 },
        ...overrides,
    }
}

beforeEach(() => {
    getMock.mockReset()
})

afterEach(cleanup)

describe('SystemStatusPanel', () => {
    it('shows a loading message before the first report arrives', () => {
        getMock.mockReturnValue(new Promise(() => {}))

        render(<SystemStatusPanel pollIntervalMs={0} />)

        expect(screen.getByText(/checking live connectivity/i)).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveAttribute('data-status', 'loading')
    })

    it('renders both upstream checks from the live report', async () => {
        getMock.mockResolvedValue(report())

        const { container } = render(<SystemStatusPanel pollIntervalMs={0} />)

        await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent(/all systems operational/i))

        const oracle = container.querySelector('[data-check="reflector_oracle"]') as HTMLElement
        const dex = container.querySelector('[data-check="stellar_dex"]') as HTMLElement

        expect(within(oracle).getByText(/reflector oracle is reachable/i)).toBeInTheDocument()
        expect(within(oracle).getByText('42 ms')).toBeInTheDocument()
        expect(within(oracle).getByText('12:34:50 UTC')).toBeInTheDocument()
        expect(within(dex).getByText(/quoting the probed pair/i)).toBeInTheDocument()
        expect(within(dex).getByText('61 ms')).toBeInTheDocument()
        expect(container.querySelector('[data-status="healthy"]')).not.toBeNull()
        expect(screen.getByText('12:34:56 UTC')).toBeInTheDocument()
    })

    it('surfaces a degraded DEX as degraded rather than healthy', async () => {
        getMock.mockResolvedValue(
            report({
                status: 'degraded',
                checks: {
                    reflector_oracle: check('ok', { reason: 'ok', message: 'Oracle is fine.' }),
                    stellar_dex: check('degraded', {
                        reason: 'no_path',
                        message: 'Stellar DEX is reachable but found no route for the probed pair.',
                    }),
                },
            }),
        )

        const { container } = render(<SystemStatusPanel pollIntervalMs={0} />)

        await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent(/degraded performance/i))

        const dex = container.querySelector('[data-check="stellar_dex"]') as HTMLElement
        expect(within(dex).getByText('Degraded')).toBeInTheDocument()
        expect(within(dex).getByText('no_path')).toBeInTheDocument()
        expect(container.querySelector('[data-check="stellar_dex"]')).toHaveAttribute('data-status', 'degraded')
    })

    it('surfaces an unreachable upstream as unavailable', async () => {
        getMock.mockResolvedValue(
            report({
                status: 'unhealthy',
                checks: {
                    reflector_oracle: check('ok', { reason: 'ok', message: 'Oracle is fine.' }),
                    stellar_dex: check('down', {
                        reason: 'timeout',
                        message: 'Stellar DEX did not answer the route query in time.',
                    }),
                },
            }),
        )

        const { container } = render(<SystemStatusPanel pollIntervalMs={0} />)

        await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent(/connectivity problem/i))

        const dex = container.querySelector('[data-check="stellar_dex"]') as HTMLElement
        expect(within(dex).getByText('Unavailable')).toBeInTheDocument()
        expect(within(dex).getByText('timeout')).toBeInTheDocument()
        expect(container.querySelector('[data-status="unhealthy"]')).not.toBeNull()
    })

    it('never claims healthy when the status API is unreachable', async () => {
        getMock.mockRejectedValue(new Error('Network request failed'))

        const { container } = render(<SystemStatusPanel pollIntervalMs={0} />)

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(/live status unavailable/i)
        expect(alert).toHaveTextContent('Network request failed')
        expect(screen.queryByTestId('overall-status')).toBeNull()
        expect(container.querySelector('[data-status="unavailable"]')).not.toBeNull()
    })

    it('recovers when a retry succeeds', async () => {
        getMock.mockRejectedValueOnce(new Error('Network request failed'))
        getMock.mockResolvedValue(report())

        render(<SystemStatusPanel pollIntervalMs={0} />)

        await screen.findByRole('alert')
        fireEvent.click(screen.getByRole('button', { name: /try again/i }))

        await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent(/all systems operational/i))
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('re-reads the report when refresh is pressed', async () => {
        getMock.mockResolvedValue(report())

        render(<SystemStatusPanel pollIntervalMs={0} />)
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

        fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2))
    })

    it('polls for fresh connectivity on the configured interval', async () => {
        getMock.mockResolvedValue(report())

        render(<SystemStatusPanel pollIntervalMs={20} />)
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

        await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(1))
    })

    it('does not poll when the interval is disabled', async () => {
        getMock.mockResolvedValue(report())

        render(<SystemStatusPanel pollIntervalMs={0} />)
        await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

        await new Promise((resolve) => setTimeout(resolve, 60))

        expect(getMock).toHaveBeenCalledTimes(1)
    })

    it('marks a cached report as cached', async () => {
        getMock.mockResolvedValue(report({ cache: { cached: true, age_ms: 1200, ttl_ms: 15000 } }))

        render(<SystemStatusPanel pollIntervalMs={0} />)

        await waitFor(() => expect(screen.getByText(/cached response/i)).toBeInTheDocument())
    })
})
