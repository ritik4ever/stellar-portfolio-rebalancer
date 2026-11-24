import { useEffect, useState, useRef } from 'react'
import { usePortfolioDetails, useRebalancePlan } from '../hooks/queries/usePortfolioQuery'
import { useExecuteRebalanceMutation } from '../hooks/mutations/usePortfolioMutations'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

function readSlippageTolerance(details: any): number | null {
    if (!details) return null
    const raw = details.slippageTolerancePercent ?? details.slippageTolerance
    const value = typeof raw === 'string' ? Number(raw) : raw
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isSlippageFailure(message: string | null): boolean {
    if (!message) return false
    return /slippage|tolerance|price (?:moved|changed|deviated)|quote (?:expired|stale)/i.test(message)
}

function formatPercent(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

interface RebalanceConfirmProps {
    portfolioId: string | null
    open: boolean
    onClose: () => void
    onSuccess?: (result: any) => void
}

export default function RebalanceConfirm({ open, ...props }: RebalanceConfirmProps) {
    return open ? <RebalanceReview key={props.portfolioId} {...props} /> : null
}

function RebalanceReview({ portfolioId, onClose, onSuccess }: Omit<RebalanceConfirmProps, 'open'>) {
    const { data: plan, isLoading, isFetching, isError, error: planError, refetch } = useRebalancePlan(portfolioId)
    const { data: portfolioDetails } = usePortfolioDetails(portfolioId)
    const execute = useExecuteRebalanceMutation(portfolioId)
    const [reviewedPlan, setReviewedPlan] = useState<typeof plan>()
    const [executionError, setExecutionError] = useState<string | null>(null)
    const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingRef = useRef(false)
    const errorAlertRef = useRef<HTMLDivElement>(null)
    const boundaryStatusRef = useRef<HTMLDivElement>(null)
    const [now, setNow] = useState(Date.now)

    useEffect(() => {
        if (executionError) {
            errorAlertRef.current?.focus()
        }
    }, [executionError])

    useEffect(() => {
        if (plan && !isError && (plan.boundary?.trades ?? []).length === 0) {
            boundaryStatusRef.current?.focus()
        }
    }, [plan, isError])

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 15000)
        return () => clearInterval(timer)
    }, [])
    const boundary = plan?.boundary
    const trades = boundary?.trades ?? []
    const fees = plan?.estimatedFees
    const quote = boundary?.quoteSnapshot
    const requiredQuotes = new Set(trades.map(({ asset }) => asset))
    if (fees && fees.xlm > 0) requiredQuotes.add('XLM')
    const quoteDates = Array.from(requiredQuotes, asset => {
        const timestamp = quote?.prices?.[asset]?.timestamp
        if (!timestamp || timestamp <= 0) return NaN
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).getTime()
    })
    const oldestQuoteMs = quoteDates.length > 0 && quoteDates.every(Number.isFinite) ? Math.min(...quoteDates) : null
    const quoteAgeMinutes = oldestQuoteMs === null ? null : Math.max(0, Math.floor((now - oldestQuoteMs) / 60000))
    const hasTrades = trades.length > 0
    const confirmed = !!plan && reviewedPlan === plan
    useEffect(() => {
        if (reviewedPlan && reviewedPlan !== plan) setReviewedPlan(undefined)
    }, [plan, reviewedPlan])
    const inFlight = isSubmitting || execute.isPending
    const activeTolerance = readSlippageTolerance(portfolioDetails)
    const planTolerance = plan?.maxSlippagePercent
    const toleranceChanged = plan != null
        && activeTolerance != null
        && planTolerance != null
        && Number.isFinite(planTolerance)
        && Math.abs(activeTolerance - planTolerance) > 1e-9
    const canConfirm = hasTrades && confirmed && !isFetching && !isError && !inFlight && !toleranceChanged
    const withinThreshold = boundary?.reasonCode === 'WITHIN_EVERY_THRESHOLD'
    const thresholdAmountCopy = boundary?.thresholdPercent != null && Number.isFinite(boundary.thresholdPercent)
        ? `${boundary.thresholdPercent.toFixed(2)} percentage points`
        : null
    const thresholdCopy = thresholdAmountCopy ? `±${thresholdAmountCopy}` : null
    const maxDriftCopy = boundary?.maxDriftPercent != null && Number.isFinite(boundary.maxDriftPercent)
        ? `${boundary.maxDriftPercent.toFixed(2)} percentage points`
        : null
    const noTradeStatusId = plan && !hasTrades && !isError ? 'dry-run-boundary-status' : undefined
    const isTimeout = isError && /timeout|timed out/i.test(String((planError as Error | undefined)?.message ?? planError ?? ''))
    const timeoutCopy = isTimeout
        ? 'The simulation request timed out. Retry loading the plan, or cancel to abandon.'
        : 'The rebalance plan is unavailable.'

    const refreshPlan = async () => {
        if (isFetching || inFlight) return
        setExecutionError(null)
        setReviewedPlan(undefined)
        setStatusAnnouncement('Refreshing the rebalance plan…')
        try {
            await refetch()
        } finally {
            setStatusAnnouncement(null)
        }
    }

    const handleConfirm = async () => {
        if (submittingRef.current || inFlight) {
            setStatusAnnouncement('Rebalance submission is already in progress.')
            return
        }
        if (!canConfirm) return
        submittingRef.current = true
        setIsSubmitting(true)
        setExecutionError(null)
        setStatusAnnouncement('Submitting rebalance…')
        try {
            const result = await execute.mutateAsync()
            submittingRef.current = false
            setIsSubmitting(false)
            onSuccess?.(result)
            onClose()
        } catch (error) {
            submittingRef.current = false
            setIsSubmitting(false)
            setReviewedPlan(undefined)
            setStatusAnnouncement(null)
            setExecutionError(error instanceof Error ? error.message : 'Rebalance failed. Please try again.')
        }
    }

    return (
        <Modal
            open
            title="Review rebalance"
            onClose={() => { if (!inFlight) onClose() }}
            footer={(
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    <Button variant="secondary" onClick={onClose} disabled={inFlight} aria-describedby={noTradeStatusId}>
                        {plan && !hasTrades ? 'Close' : 'Cancel'}
                    </Button>
                    {hasTrades && !isError && (
                        <Button
                            variant="primary"
                            onClick={handleConfirm}
                            disabled={!canConfirm}
                            loading={inFlight}
                            aria-busy={inFlight}
                            aria-label={inFlight ? 'Submitting rebalance…' : 'Confirm rebalance'}
                        >
                            {inFlight ? 'Submitting rebalance…' : 'Confirm rebalance'}
                        </Button>
                    )}
                </div>
            )}
        >
            {statusAnnouncement && (
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {statusAnnouncement}
                </div>
            )}
            {isLoading ? (
                <p role="status">Loading rebalance plan…</p>
            ) : isError || !plan || !fees ? (
                <div className="min-w-0 space-y-2 break-words">
                    <p role="alert">{timeoutCopy}</p>
                    <div className="flex min-w-0 flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
                            Retry loading plan
                        </Button>
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : !hasTrades ? (
                <div
                    id="dry-run-boundary-status"
                    ref={boundaryStatusRef}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    tabIndex={-1}
                    className="min-w-0 space-y-2 break-words outline-none focus-visible:ring-2"
                >
                    <p className="font-semibold">0 planned trades — read-only preview</p>
                    {withinThreshold && thresholdCopy ? (
                        <p>
                            {maxDriftCopy ? `Largest observed drift is ${maxDriftCopy}. ` : ''}
                            Allowed drift is {thresholdCopy} or less from target (inclusive): an allocation exactly at {thresholdCopy} is still inside the threshold, and only absolute drift above {thresholdAmountCopy} is traded. No trades are required and there is no network fee.
                        </p>
                    ) : withinThreshold ? (
                        <p>All allocations are within the configured drift threshold. No trades are required and there is no network fee.</p>
                    ) : (
                        <p>This plan contains no executable trades. Close the review and try again when quotes or balances change.</p>
                    )}
                </div>
            ) : (
                <div className="max-h-[65vh] min-w-0 space-y-3 overflow-y-auto break-words text-sm">
                    <h3 id="quoted-trades" className="font-semibold">
                        {trades.length} planned {trades.length === 1 ? 'trade' : 'trades'}
                    </h3>
                    {trades.length > 4 && <p>Scroll the trade list to review all planned trades.</p>}
                    <div role="region" tabIndex={0} aria-labelledby="quoted-trades"
                        className="max-h-36 min-w-0 overflow-y-auto rounded bg-gray-50 p-2 focus-visible:ring-2 dark:bg-gray-900">
                        <ol className="list-decimal space-y-1 pl-6 break-words">
                            {trades.map(trade => (
                                <li key={trade.asset} className="min-w-0 break-words">
                                    {trade.action === 'buy' ? 'Buy' : 'Sell'} {trade.amount.toLocaleString(undefined, { maximumFractionDigits: 7 })} {trade.asset}
                                </li>
                            ))}
                        </ol>
                    </div>
                    <p className="min-w-0 break-words">Estimated network fee for all trades: {fees.xlm.toFixed(7)} XLM (~${fees.usd.toFixed(3)})</p>
                    <p className="min-w-0 break-words">
                        {oldestQuoteMs === null
                            ? 'Price age unavailable for one or more quotes.'
                            : <>Oldest quoted price as of <time dateTime={new Date(oldestQuoteMs).toISOString()}>{new Date(oldestQuoteMs).toLocaleString()}</time> ({quoteAgeMinutes === 0 ? 'less than 1 minute old' : `${quoteAgeMinutes} min old`}).</>}
                    </p>
                    {quote?.feedMeta.degraded && <p className="min-w-0 break-words">Some prices use a fallback feed.</p>}
                    {quote?.feedMeta.staleOrLimited && <p className="min-w-0 break-words">Some quoted prices may be stale.</p>}
                    {toleranceChanged && (
                        <div
                            role="alert"
                            className="min-w-0 space-y-2 break-words rounded border border-amber-300 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                        >
                            <p className="font-semibold">Slippage tolerance changed after this plan was quoted</p>
                            <p>
                                These trades were quoted with a {formatPercent(planTolerance)}% maximum slippage, but the portfolio now uses {formatPercent(activeTolerance!)}%.
                                Refresh the plan to re-price the trades before confirming.
                            </p>
                            <Button variant="secondary" size="sm" onClick={() => void refreshPlan()} disabled={isFetching || inFlight}>
                                {isFetching ? 'Refreshing…' : 'Refresh plan'}
                            </Button>
                        </div>
                    )}
                    <p className="min-w-0 break-words">Maximum slippage: {plan.maxSlippagePercent}%</p>
                    <p className="min-w-0 break-words">The execution price and fees may change. Executed trades cannot be reversed from this app.</p>
                    <label className="flex min-w-0 items-start gap-2 break-words">
                        <input type="checkbox" checked={confirmed} disabled={isFetching || inFlight}
                            aria-label="I reviewed the planned trades, fees, and prices."
                            onChange={event => setReviewedPlan(event.target.checked ? plan : undefined)} />
                        <span className="min-w-0 break-words">I reviewed the planned trades, fees, and prices.</span>
                    </label>
                </div>
            )}
            {executionError && (
                <div
                    ref={errorAlertRef}
                    role="alert"
                    tabIndex={-1}
                    className="mt-3 min-w-0 break-words rounded border border-red-200 bg-red-50 p-2.5 text-sm text-red-700 outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                >
                    <p className="font-semibold">Rebalance submission failed</p>
                    <p className="min-w-0 break-words">{executionError}</p>
                    {isSlippageFailure(executionError) ? (
                        <>
                            <p className="mt-1 min-w-0 break-words text-xs text-red-600 dark:text-red-400">
                                Prices moved beyond your slippage limit before the rebalance was accepted, so nothing was executed.
                                Refresh the plan for fresh prices, re-acknowledge, and try again.
                            </p>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="mt-2"
                                onClick={() => void refreshPlan()}
                                disabled={isFetching || inFlight}
                            >
                                {isFetching ? 'Refreshing…' : 'Refresh quote and retry'}
                            </Button>
                        </>
                    ) : (
                        <p className="mt-1 min-w-0 break-words text-xs text-red-600 dark:text-red-400">
                            Review and re-acknowledge the planned trades to retry, or cancel to abandon.
                        </p>
                    )}
                </div>
            )}
        </Modal>
    )
}
