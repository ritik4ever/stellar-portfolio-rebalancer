import React, { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, History } from 'lucide-react'
import { api, ApiClientError, API_RESOURCE_ROOT } from '../config/api'
import { historicalSimulatorCopy as copy } from '../content/uiCopy'
import { formatPercent, formatUsdCompact } from '../utils/localeFormat'
import {
    SIMULATOR_MAX_DAYS,
    SIMULATOR_MIN_DAYS,
    getAllowedSimulatorDates,
    getPresetRange,
    toBacktestWindow,
    validateSimulatorRange,
} from '../utils/backtestWindow'

interface HistoricalSimulatorProps {
    portfolioId: string
}

interface BacktestResponse {
    startDate: string
    endDate: string
    finalValue: number
    totalReturnPct: number
    buyAndHoldReturnPct: number
    rebalanceCount: number
    maxDrawdownPct: number
    absentDays?: Array<{ date: string; reason: string }>
    decision: {
        totalWindowDays: number
        includedDaysCount: number
        hasLeapDay: boolean
        leapDayIncluded: boolean
    }
    dataSource: string
    disclaimer: string
}

interface CompletedRun {
    requestedStart: string
    requestedEnd: string
    requestedDays: number
    result: BacktestResponse
}

interface RunFailure {
    title: string
    detail: string
    isInsufficientHistory?: boolean
}

type RunStatus = 'idle' | 'running' | 'completed' | 'failed'
type FocusTarget = 'cancel' | 'run' | 'result' | 'error' | 'start'

const PRESET_DAYS = [SIMULATOR_MIN_DAYS, 30, 90, SIMULATOR_MAX_DAYS]
const DEFAULT_DAYS = 30
const ADJUST_DATES_LABEL = 'Adjust dates'
const useShorterRangeLabel = (days: number) => `Try last ${days} days`
const shorterRangeSelectedMessage = (days: number) =>
    `Switched to the last ${days} closed days. Review the range and run the simulation.`

const controlFocus = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
const secondaryButton = `min-h-11 px-3 py-2 text-sm rounded-lg font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed ${controlFocus}`

function describeFailure(error: unknown): RunFailure {
    if (error instanceof ApiClientError) {
        if (error.code === 'HISTORICAL_DATA_UNAVAILABLE') {
            return {
                title: copy.insufficientTitle,
                detail: `${error.message}. ${copy.insufficientDetail}`,
                isInsufficientHistory: true,
            }
        }
        if (error.code === 'CONFLICT') return { title: copy.failedTitle, detail: copy.conflictDetail }
        if (error.code === 'REQUEST_TIMEOUT') return { title: copy.failedTitle, detail: copy.timeoutDetail }
        if (error.code === 'VALIDATION_ERROR') return { title: copy.failedTitle, detail: error.message }
    }
    return { title: copy.failedTitle, detail: copy.genericDetail }
}

function isBacktestResponse(value: unknown): value is BacktestResponse {
    return Boolean(value && typeof value === 'object' && 'decision' in value)
}

const HistoricalSimulator: React.FC<HistoricalSimulatorProps> = ({ portfolioId }) => {
    const baseId = useId()
    const [range, setRange] = useState(() => getPresetRange(DEFAULT_DAYS, Date.now()))
    const [status, setStatus] = useState<RunStatus>('idle')
    const [run, setRun] = useState<CompletedRun | null>(null)
    const [failure, setFailure] = useState<RunFailure | null>(null)
    const [showErrors, setShowErrors] = useState(false)
    const [announcement, setAnnouncement] = useState('')

    const activeRun = useRef(0)
    const isRunningRef = useRef(false)
    const pendingFocus = useRef<FocusTarget | null>(null)
    const startRef = useRef<HTMLInputElement>(null)
    const endRef = useRef<HTMLInputElement>(null)
    const runRef = useRef<HTMLButtonElement>(null)
    const cancelRef = useRef<HTMLButtonElement>(null)
    const resultRef = useRef<HTMLHeadingElement>(null)
    const errorRef = useRef<HTMLDivElement>(null)

    const now = Date.now()
    const { earliest, latest } = getAllowedSimulatorDates(now)
    const validation = validateSimulatorRange(range.start, range.end, now)
    const isRunning = status === 'running'
    const visibleError = showErrors ? validation.error : null

    const hintId = `${baseId}-hint`
    const errorId = `${baseId}-range-error`
    const describedBy = (field: 'start' | 'end') =>
        visibleError && validation.field === field ? `${hintId} ${errorId}` : hintId

    useEffect(() => () => {
        activeRun.current += 1
        isRunningRef.current = false
    }, [])

    useEffect(() => {
        const target = pendingFocus.current
        if (!target) return
        pendingFocus.current = null
        const elements = {
            cancel: cancelRef,
            run: runRef,
            result: resultRef,
            error: errorRef,
            start: startRef,
        }
        elements[target].current?.focus()
    })

    const updateRange = (next: { start: string; end: string }) => {
        setRange(next)
        if (run || failure) setAnnouncement(copy.resultCleared)
        setRun(null)
        setFailure(null)
        setStatus('idle')
    }

    const selectPreset = (days: number) => {
        updateRange(getPresetRange(days, Date.now()))
        setShowErrors(false)
    }

    const runSimulation = async () => {
        if (isRunningRef.current) return
        const current = validateSimulatorRange(range.start, range.end, Date.now())
        if (!current.valid || current.days === null) {
            setShowErrors(true)
            setAnnouncement(current.error ?? '')
            if (current.field === 'end') endRef.current?.focus()
            else startRef.current?.focus()
            return
        }

        isRunningRef.current = true
        const id = activeRun.current + 1
        activeRun.current = id
        const requested = { requestedStart: range.start, requestedEnd: range.end, requestedDays: current.days }
        setRun(null)
        setFailure(null)
        setStatus('running')
        setAnnouncement(copy.running(range.start, range.end))
        pendingFocus.current = 'cancel'

        try {
            const result = await api.post<unknown>(`${API_RESOURCE_ROOT}/backtest`, {
                portfolioId,
                ...toBacktestWindow(range.start, range.end, current.days),
            })
            if (activeRun.current !== id) return
            if (!isBacktestResponse(result)) throw new Error('Unexpected backtest response')
            isRunningRef.current = false
            setRun({ ...requested, result })
            setStatus('completed')
            setAnnouncement(
                copy.completed(result.decision.includedDaysCount, current.days),
            )
            pendingFocus.current = 'result'
        } catch (error) {
            if (activeRun.current !== id) return
            isRunningRef.current = false
            setFailure(describeFailure(error))
            setStatus('failed')
            setAnnouncement('')
            pendingFocus.current = 'error'
        }
    }

    const cancelRun = () => {
        activeRun.current += 1
        isRunningRef.current = false
        setStatus('idle')
        setAnnouncement(copy.cancelled)
        pendingFocus.current = 'run'
    }

    const dismissResult = () => {
        setRun(null)
        setFailure(null)
        setStatus('idle')
        setAnnouncement(copy.dismissed)
        pendingFocus.current = 'run'
    }

    const adjustDates = () => {
        startRef.current?.focus()
    }

    const applyShorterRange = () => {
        setRange(getPresetRange(SIMULATOR_MIN_DAYS, Date.now()))
        setShowErrors(false)
        setRun(null)
        setFailure(null)
        setStatus('idle')
        setAnnouncement(shorterRangeSelectedMessage(SIMULATOR_MIN_DAYS))
        pendingFocus.current = 'run'
    }

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault()
        if (!isRunning) void runSimulation()
    }

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && isRunning) {
            event.preventDefault()
            cancelRun()
        }
    }

    const result = run?.result
    const absentDays = result?.absentDays ?? []
    const isPartial = Boolean(run && result && result.decision.includedDaysCount < run.requestedDays)

    return (
        <section
            aria-labelledby={`${baseId}-title`}
            className="mt-6 min-w-0 bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 shadow-sm"
            onKeyDown={handleKeyDown}
        >
            <div className="flex items-start gap-2 mb-1">
                <History className="w-5 h-5 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
                <h2 id={`${baseId}-title`} className="min-w-0 break-words text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                    {copy.title}
                </h2>
            </div>
            <p className="mb-4 break-words text-sm text-gray-600 dark:text-gray-400">{copy.sourceBefore}</p>

            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {announcement}
            </div>

            <form onSubmit={handleSubmit} noValidate aria-busy={isRunning}>
                <fieldset disabled={isRunning} className="min-w-0">
                    <legend className="mb-2 text-sm font-medium text-gray-900 dark:text-white">{copy.rangeLegend}</legend>

                    <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={copy.presetsLabel}>
                        {PRESET_DAYS.map((days) => {
                            const preset = getPresetRange(days, now)
                            const selected = preset.start === range.start && preset.end === range.end
                            return (
                                <button
                                    key={days}
                                    type="button"
                                    aria-pressed={selected}
                                    aria-label={copy.presetName(days)}
                                    onClick={() => selectPreset(days)}
                                    className={selected
                                        ? `min-h-11 px-3 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white disabled:opacity-50 ${controlFocus}`
                                        : secondaryButton}
                                >
                                    {copy.presetLabel(days)}
                                </button>
                            )
                        })}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="min-w-0">
                            <label htmlFor={`${baseId}-start`} className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                                {copy.startLabel}
                            </label>
                            <input
                                ref={startRef}
                                id={`${baseId}-start`}
                                type="date"
                                required
                                min={earliest}
                                max={latest}
                                value={range.start}
                                onChange={(event) => {
                                    setShowErrors(true)
                                    updateRange({ ...range, start: event.target.value })
                                }}
                                aria-invalid={Boolean(visibleError && validation.field === 'start')}
                                aria-describedby={describedBy('start')}
                                className={`block w-full min-w-0 max-w-full min-h-11 px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 ${controlFocus}`}
                            />
                        </div>
                        <div className="min-w-0">
                            <label htmlFor={`${baseId}-end`} className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                                {copy.endLabel}
                            </label>
                            <input
                                ref={endRef}
                                id={`${baseId}-end`}
                                type="date"
                                required
                                min={earliest}
                                max={latest}
                                value={range.end}
                                onChange={(event) => {
                                    setShowErrors(true)
                                    updateRange({ ...range, end: event.target.value })
                                }}
                                aria-invalid={Boolean(visibleError && validation.field === 'end')}
                                aria-describedby={describedBy('end')}
                                className={`block w-full min-w-0 max-w-full min-h-11 px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 ${controlFocus}`}
                            />
                        </div>
                    </div>
                </fieldset>

                <div id={hintId} className="mt-3 space-y-1 break-words text-sm text-gray-600 dark:text-gray-400">
                    <p>{copy.allowedRange(earliest, latest)}</p>
                    {validation.days !== null && <p>{copy.selectedDays(validation.days)}</p>}
                    {validation.leapDays.length > 0 && <p>{copy.leapDayNotice(validation.leapDays.join(', '))}</p>}
                </div>

                {visibleError && (
                    <p id={errorId} className="mt-2 break-words text-sm font-medium text-red-700 dark:text-red-400">
                        {visibleError}
                    </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                    {isRunning ? (
                        <button ref={cancelRef} type="button" onClick={cancelRun} className={secondaryButton}>
                            {copy.cancel}
                        </button>
                    ) : (
                        <button
                            ref={runRef}
                            type="submit"
                            className={`min-h-11 px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 ${controlFocus}`}
                        >
                            {status === 'failed' ? copy.retry : copy.run}
                        </button>
                    )}
                </div>
                {isRunning && <p className="mt-2 break-words text-sm text-gray-600 dark:text-gray-400">{copy.runningHint}</p>}
            </form>

            {failure && (
                <div
                    ref={errorRef}
                    role="alert"
                    tabIndex={-1}
                    className={`mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300 ${controlFocus}`}
                >
                    <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                        <div className="min-w-0 break-words">
                            <p className="font-semibold">{failure.title}</p>
                            <p className="mt-1">{failure.detail}</p>
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {failure.isInsufficientHistory && (
                            <>
                                <button type="button" onClick={adjustDates} className={secondaryButton}>
                                    {ADJUST_DATES_LABEL}
                                </button>
                                {(validation.days === null || validation.days > SIMULATOR_MIN_DAYS) && (
                                    <button type="button" onClick={applyShorterRange} className={secondaryButton}>
                                        {useShorterRangeLabel(SIMULATOR_MIN_DAYS)}
                                    </button>
                                )}
                            </>
                        )}
                        <button type="button" onClick={dismissResult} className={secondaryButton}>
                            {copy.dismiss}
                        </button>
                    </div>
                </div>
            )}

            {run && result && (
                <div className="mt-6 min-w-0 border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3
                        ref={resultRef}
                        tabIndex={-1}
                        className={`break-words text-base font-semibold text-gray-900 dark:text-white ${controlFocus}`}
                    >
                        {copy.resultTitle}
                    </h3>
                    <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        {[
                            [copy.requestedRange, `${run.requestedStart} to ${run.requestedEnd} (${copy.dayCount(run.requestedDays)})`],
                            [copy.evaluatedRange, `${result.startDate} to ${result.endDate} (${copy.dayCount(result.decision.includedDaysCount)})`],
                            [copy.dataSource, copy.sourceName(result.dataSource)],
                            [copy.finalValue, formatUsdCompact(result.finalValue)],
                            [copy.totalReturn, formatPercent(result.totalReturnPct)],
                            [copy.buyAndHold, formatPercent(result.buyAndHoldReturnPct)],
                            [copy.rebalances, String(result.rebalanceCount)],
                            [copy.maxDrawdown, formatPercent(result.maxDrawdownPct)],
                        ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                                <dt className="text-gray-600 dark:text-gray-400">{label}</dt>
                                <dd className="break-words font-medium text-gray-900 dark:text-white">{value}</dd>
                            </div>
                        ))}
                    </dl>

                    {isPartial && (
                        <p className="mt-3 break-words rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200">
                            {copy.partial(result.decision.includedDaysCount, run.requestedDays)}
                        </p>
                    )}
                    {result.decision.hasLeapDay && (
                        <p className="mt-3 break-words text-sm text-gray-700 dark:text-gray-300">
                            {result.decision.leapDayIncluded ? copy.leapIncluded : copy.leapOmitted}
                        </p>
                    )}
                    {absentDays.length > 0 && (
                        <details className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                            <summary className={`cursor-pointer font-medium ${controlFocus}`}>
                                {copy.absentSummary(absentDays.length)}
                            </summary>
                            <ul className="mt-2 space-y-1">
                                {absentDays.map((day) => (
                                    <li key={day.date} className="break-words">{day.date}: {day.reason}</li>
                                ))}
                            </ul>
                        </details>
                    )}
                    <p className="mt-3 break-words text-xs text-gray-600 dark:text-gray-400">{result.disclaimer}</p>
                    <button type="button" onClick={dismissResult} className={`mt-3 ${secondaryButton}`}>
                        {copy.clearResult}
                    </button>
                </div>
            )}
        </section>
    )
}

export default HistoricalSimulator
