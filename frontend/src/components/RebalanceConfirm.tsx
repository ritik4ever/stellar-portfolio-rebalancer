import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertCircle, Clock, TrendingUp, TrendingDown, RefreshCw, X } from 'lucide-react'
import { useRebalanceEstimate, useRebalancePlan } from '../hooks/queries/usePortfolioQuery'
import { useExecuteRebalanceMutation } from '../hooks/mutations/usePortfolioMutations'
import { Button } from './ui/Button'

interface RebalanceConfirmProps {
  portfolioId: string | null
  open: boolean
  onClose: () => void
  onSuccess?: (result: any) => void
  cooldownSeconds?: number
}

interface TradeEstimate {
  fromAsset: string
  toAsset: string
  amount: number
  expectedPrice: number
  estimatedSlippageBps: number
}

interface RebalanceSimulationData {
  trades: TradeEstimate[]
  totalGasXlm: number
  totalGasUsd: number
  maxSlippageBps: number
  estimatedSlippageBps: number
  tradeCount: number
  gasWarning: boolean
  cooldownRemaining?: number
}

function formatSlippage(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

function formatAmount(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return value.toFixed(4)
}

const RebalanceConfirm: React.FC<RebalanceConfirmProps> = ({
  portfolioId,
  open,
  onClose,
  onSuccess,
  cooldownSeconds = 60,
}) => {
  const [confirmed, setConfirmed] = useState(false)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [lastRebalanceTime, setLastRebalanceTime] = useState<number | null>(null)

  const { data: estimate, isLoading: estimateLoading } = useRebalanceEstimate(portfolioId)
  const executeRebalance = useExecuteRebalanceMutation(portfolioId)

  useEffect(() => {
    if (!open) {
      setConfirmed(false)
      setCooldownRemaining(0)
    }
  }, [open])

  useEffect(() => {
    if (!estimate?.lastRebalanceTimestamp) return
    const lastTime = new Date(estimate.lastRebalanceTimestamp).getTime()
    setLastRebalanceTime(lastTime)
  }, [estimate])

  const effectiveCooldown = useMemo(() => {
    if (!lastRebalanceTime) return 0
    const elapsed = (Date.now() - lastRebalanceTime) / 1000
    return Math.max(0, cooldownSeconds - elapsed)
  }, [lastRebalanceTime, cooldownSeconds])

  useEffect(() => {
    if (effectiveCooldown <= 0) {
      setCooldownRemaining(0)
      return
    }
    setCooldownRemaining(Math.ceil(effectiveCooldown))
    const interval = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [effectiveCooldown])

  const simData = useMemo<RebalanceSimulationData | null>(() => {
    if (!estimate) return null
    return {
      trades: estimate.trades ?? [],
      totalGasXlm: estimate.gasEstimateXlm ?? 0,
      totalGasUsd: estimate.gasEstimateUsd ?? 0,
      maxSlippageBps: estimate.maxSlippageBps ?? estimate.slippageToleranceBps ?? 100,
      estimatedSlippageBps: estimate.estimatedSlippageBps ?? 0,
      tradeCount: estimate.tradeCount ?? estimate.trades?.length ?? 0,
      gasWarning: estimate.gasWarning ?? (estimate.gasEstimateXlm ?? 0) > 0.5,
      cooldownRemaining: effectiveCooldown,
    }
  }, [estimate, effectiveCooldown])

  const handleConfirm = useCallback(async () => {
    if (cooldownRemaining > 0 || !confirmed) return
    try {
      const result = await executeRebalance.mutateAsync()
      onSuccess?.(result)
      setLastRebalanceTime(Date.now())
      onClose()
    } catch {
      // Error handled by mutation
    }
  }, [confirmed, cooldownRemaining, executeRebalance, onSuccess, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rebalance-confirm-title"
    >
      <div className="absolute inset-0 bg-black/60 dark:bg-black/70" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            <h2 id="rebalance-confirm-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Review rebalance
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {estimateLoading ? (
          <div className="py-8 text-center">
            <RefreshCw className="w-8 h-8 mx-auto text-gray-400 motion-safe:animate-spin" aria-hidden="true" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading rebalance estimate...</p>
          </div>
        ) : !simData ? (
          <div className="py-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600" aria-hidden="true" />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Unable to load rebalance data. Please try again.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {cooldownRemaining > 0 && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg" role="alert">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Cooldown active</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Please wait {Math.ceil(cooldownRemaining)} second{cooldownRemaining !== 1 ? 's' : ''} before rebalancing again.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Estimated trades</h3>
              {simData.tradeCount === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No trades are required at current allocations.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {simData.tradeCount} trade{simData.tradeCount !== 1 ? 's' : ''} estimated
                  </p>
                  {simData.trades.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {simData.trades.map((trade, i) => (
                        <div key={i} className="flex items-center justify-between text-sm bg-white dark:bg-gray-800 rounded px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-gray-900 dark:text-white">{trade.fromAsset}</span>
                            <TrendingUp className="w-3 h-3 text-gray-400" />
                            <span className="font-medium text-gray-900 dark:text-white">{trade.toAsset}</span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatAmount(trade.amount)} @ {formatSlippage(trade.estimatedSlippageBps)} slippage
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  Network fee
                </div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {simData.totalGasXlm.toFixed(4)} XLM
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  ~${simData.totalGasUsd.toFixed(3)}
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <TrendingDown className="w-3 h-3" aria-hidden="true" />
                  Max slippage
                </div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatSlippage(simData.maxSlippageBps)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Est. {formatSlippage(simData.estimatedSlippageBps)}
                </div>
              </div>
            </div>

            {simData.gasWarning && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg" role="alert">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">High gas warning</p>
                  <p className="text-xs text-red-700 dark:text-red-400">
                    Estimated gas is higher than usual ({simData.totalGasXlm.toFixed(2)} XLM). Consider fewer trades or waiting for calmer network conditions.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Executed trades cannot be reversed from this app. Review allocations before confirming.
              </p>
            </div>

            <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={cooldownRemaining > 0}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                I have reviewed the estimated trades, fees, and slippage. I understand that executed trades cannot be reversed.
              </span>
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={executeRebalance.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!confirmed || cooldownRemaining > 0 || !simData || executeRebalance.isPending}
            loading={executeRebalance.isPending}
          >
            {executeRebalance.isPending ? 'Submitting...' : cooldownRemaining > 0 ? `Wait ${Math.ceil(cooldownRemaining)}s` : 'Confirm rebalance'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RebalanceConfirm
