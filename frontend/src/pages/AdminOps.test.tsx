import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminOps from './AdminOps';
import { useSystemStatusQuery, useQueueHealthQuery, useWorkersHealthQuery, useResetCircuitBreakerMutation } from '../hooks/queries/useAdminOpsQueries';

vi.mock('../services/adminService', () => ({
  adminRequest: vi.fn().mockResolvedValue({ queries: [] }),
  isAdminError: (err: any) => err?.message?.includes('403') || err?.message?.includes('FORBIDDEN'),
}))

vi.mock('../hooks/queries/useAdminOpsQueries', () => ({
  useSystemStatusQuery: vi.fn(),
  useQueueHealthQuery: vi.fn(),
  useWorkersHealthQuery: vi.fn(),
  useResetCircuitBreakerMutation: vi.fn(),
  adminOpsKeys: { all: ['admin-ops'] },
}))

const makeQuery = (overrides: Record<string, unknown> = {}) => ({
  data: null,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  refetch: vi.fn(),
  ...overrides,
})

function renderAdminOps() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  ;(useSystemStatusQuery as any).mockReturnValue(
    makeQuery({
      data: {
        data: {
          system: { uptime: 1234, timestamp: new Date().toISOString() },
          riskManagement: {
            circuitBreakers: {
              BTC: { isTriggered: true, triggerReason: '10.5% price movement', cooldownUntil: Date.now() + 120000, triggeredAssets: ['BTC'] },
              XLM: { isTriggered: false, triggerReason: undefined, cooldownUntil: undefined, triggeredAssets: [] },
            },
            enabled: true,
            alertsActive: true,
            services: {
              priceFeeds: true,
              riskManagement: true,
              webSockets: true,
              autoRebalancing: true,
              stellarNetwork: true,
              contractEventIndexer: true,
            },
          },
        },
      },
    })
  )

  ;(useQueueHealthQuery as any).mockReturnValue(
    makeQuery({
      data: {
        data: {
          redisConnected: true,
          queues: {
            portfolioCheck: { waiting: 0, active: 1, completed: 10, failed: 0, delayed: 0 },
            rebalance: { waiting: 2, active: 0, completed: 5, failed: 1, delayed: 0 },
          },
          workers: {},
        },
      },
    })
  )

  ;(useWorkersHealthQuery as any).mockReturnValue(
    makeQuery({
      data: {
        data: {
          summary: { total: 3, healthy: 2, unhealthy: 1, idle: 1, lagging: 0 },
          workers: [],
        },
      },
    })
  )

  ;(useResetCircuitBreakerMutation as any).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    reset: vi.fn(),
  })

  return render(
    <QueryClientProvider client={client}>
      <AdminOps />
    </QueryClientProvider>
  )
}

describe('AdminOps Page', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders circuit breaker tripped state correctly', async () => {
    renderAdminOps()

    expect(screen.getByText('Admin Operations')).toBeInTheDocument()
    expect(screen.getByText('BTC')).toBeInTheDocument()
    expect(screen.getByText('Tripped')).toBeInTheDocument()
    expect(screen.getByText('10.5% price movement')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()
  })

  it('does not show healthy circuit breakers as tripped', async () => {
    renderAdminOps()

    expect(screen.queryByText('XLM')).not.toBeInTheDocument()
  })

  it('shows queue backlog data', async () => {
    renderAdminOps()

    expect(screen.getByText('portfolioCheck')).toBeInTheDocument()
    expect(screen.getByText('rebalance')).toBeInTheDocument()
  })

  it('shows worker health summary', async () => {
    renderAdminOps()

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('healthy')).toBeInTheDocument()
    expect(screen.getByText('unhealthy')).toBeInTheDocument()
  })

  it('shows system status badges', async () => {
    renderAdminOps()

    expect(screen.getByText('Price Feeds')).toBeInTheDocument()
    expect(screen.getByText('WebSockets')).toBeInTheDocument()
  })

  it('displays all systems nominal when no circuit breakers are tripped', async () => {
    ;(useSystemStatusQuery as any).mockReturnValue(
      makeQuery({
        data: {
          data: {
            riskManagement: {
              circuitBreakers: {},
              enabled: true,
              alertsActive: false,
              services: {
                priceFeeds: true,
                riskManagement: true,
                webSockets: true,
                autoRebalancing: true,
                stellarNetwork: true,
                contractEventIndexer: true,
              },
            },
          },
        },
      })
    )

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={client}>
        <AdminOps />
      </QueryClientProvider>
    )

    expect(screen.getByText('All systems nominal')).toBeInTheDocument()
  })

  it('shows refresh button', async () => {
    renderAdminOps()

    expect(screen.getByText('Refresh')).toBeInTheDocument()
  })
})
