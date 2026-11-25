import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Bell, Mail, Webhook, Save, CheckCircle, AlertCircle, Loader, Download } from 'lucide-react'
import { downloadPortfolioExport } from '../config/api'
import { useNotificationPreferencesQuery } from '../hooks/queries/useNotificationPreferencesQuery'
import {
    useSaveNotificationPreferencesMutation,
    useUnsubscribeNotificationsMutation,
} from '../hooks/mutations/useNotificationMutations'
import type { NotificationPreferencesModel as Preferences } from '../hooks/queries/useNotificationPreferencesQuery'
import { NotificationTest } from './NotificationTest'

interface NotificationPreferencesProps {
    userId: string
    portfolioId?: string | null
}

const defaultPreferences: Preferences = {
    emailEnabled: false,
    emailAddress: '',
    webhookEnabled: false,
    webhookUrl: '',
    telegramEnabled: false,
    telegramChatId: '',
    events: {
        rebalance: true,
        circuitBreaker: true,
        priceMovement: true,
        riskChange: true,
    },
    digestEnabled: false,
    digestFrequency: 'realtime',
}

const WEBHOOK_SAVE_ERROR = 'Could not save webhook settings. Delivery still uses the previously saved settings.'
const SAVE_FAILURE_GUIDANCE =
    'Your changes are still shown but have not been saved. Retry with Save Preferences or choose Discard changes to return to your saved settings.'
const SAVE_ERROR_ID = 'notification-preferences-error'

function getWebhookUrlError(value: string): string | null {
    if (!value) return 'A callback URL is required when webhook delivery is enabled.'
    try {
        if (/^https?:\/\/[^/\s?#][^\s]*$/.test(value) && new URL(value).hostname) return null
    } catch {
        // The format message also covers invalid hosts and ports.
    }
    return 'Enter a valid callback URL starting with http:// or https://.'
}

const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ userId, portfolioId }) => {
    const [preferences, setPreferences] = useState<Preferences>(defaultPreferences)

    const [originalPreferences, setOriginalPreferences] = useState<Preferences | null>(null)
    const { data: prefData, isLoading: loading, error: loadError } = useNotificationPreferencesQuery(userId)
    const saveMutation = useSaveNotificationPreferencesMutation(userId)
    const unsubscribeMutation = useUnsubscribeNotificationsMutation(userId)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [emailError, setEmailError] = useState<string | null>(null)
    const [telegramError, setTelegramError] = useState<string | null>(null)
    const [exporting, setExporting] = useState<'json' | 'csv' | 'pdf' | null>(null)
    const [savedProviderActive, setSavedProviderActive] = useState(false)
    const [showUnsubscribeReason, setShowUnsubscribeReason] = useState(false)
    const [unsubscribeReason, setUnsubscribeReason] = useState('')
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const unsubscribeDialogRef = useRef<HTMLDivElement>(null)
    const unsubscribeTriggerRef = useRef<HTMLButtonElement>(null)
    const headingRef = useRef<HTMLHeadingElement>(null)
    const saveButtonRef = useRef<HTMLButtonElement>(null)
    // Where keyboard focus should go once the next render has committed. Save
    // and Discard disable themselves when there is nothing left to save, which
    // would otherwise drop focus to <body>.
    const [focusRequest, setFocusRequest] = useState<'heading' | 'save' | null>(null)

    const savePending = saveMutation.microstate.phase === 'pending'
    const unsubscribePending = unsubscribeMutation.microstate.phase === 'pending'
    const actionPending = savePending || unsubscribePending

    useEffect(() => {
        if (!prefData) return
        if (prefData.preferences) {
            setPreferences(prefData.preferences)
            setOriginalPreferences(prefData.preferences)
            setSavedProviderActive(
                prefData.preferences.emailEnabled || prefData.preferences.webhookEnabled || prefData.preferences.telegramEnabled
            )
        } else {
            setPreferences(defaultPreferences)
            setOriginalPreferences(defaultPreferences)
            setSavedProviderActive(false)
        }
    }, [prefData])

    useEffect(() => {
        if (!focusRequest) return
        const target = focusRequest === 'heading' ? headingRef.current : saveButtonRef.current
        target?.focus()
        setFocusRequest(null)
    }, [focusRequest])

    // Only move focus when it would otherwise be lost (on <body>) or is still
    // on the control that started the action, so focus is never pulled away
    // from somewhere the user deliberately moved to.
    const focusIsOnBodyOr = (element: HTMLElement | null) => {
        const active = document.activeElement
        return !active || active === document.body || active === element
    }

    useEffect(() => {
        return () => {
            if (successTimeoutRef.current) {
                clearTimeout(successTimeoutRef.current)
            }
        }
    }, [])

    const clearSuccessMessage = () => {
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current)
            successTimeoutRef.current = null
        }
        setSuccessMessage(null)
    }

    const showSuccessMessage = (message: string) => {
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current)
        }

        setSuccessMessage(message)
        successTimeoutRef.current = setTimeout(() => {
            setSuccessMessage(null)
            successTimeoutRef.current = null
        }, 3000)
    }

    const loadErrMsg =
        loadError instanceof Error ? loadError.message : loadError ? String(loadError) : null

    const validateEmail = (email: string): boolean => {
        if (!email) return true // Empty is valid when email is disabled
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }

    const handleEmailAddressChange = (email: string) => {
        setPreferences(prev => ({ ...prev, emailAddress: email }))
        if (preferences.emailEnabled && !email.trim()) {
            setEmailError('Email address is required when email notifications are enabled')
        } else if (email && !validateEmail(email.trim())) {
            setEmailError('Invalid email address format')
        } else {
            setEmailError(null)
        }
    }

    const savedWebhookUrl = originalPreferences?.webhookUrl ?? ''
    const savedWebhookActive = Boolean(originalPreferences?.webhookEnabled && savedWebhookUrl)
    const webhookUrl = preferences.webhookUrl ?? ''
    const webhookUrlChanged = webhookUrl !== savedWebhookUrl
    const webhookError = preferences.webhookEnabled
        ? getWebhookUrlError(webhookUrl)
        : null

    const handleTelegramChatIdChange = (id: string) => {
        setPreferences(prev => ({ ...prev, telegramChatId: id }))
        if (preferences.telegramEnabled && !id.trim()) {
            setTelegramError('Telegram Chat ID is required')
        } else {
            setTelegramError(null)
        }
    }

    const handleSave = async () => {
        // The Save button stays focusable (aria-disabled) while a save is in
        // flight so keyboard focus is not lost; ignore repeat activations.
        if (actionPending) return

        // Validate email address if email is enabled
        if (preferences.emailEnabled && !preferences.emailAddress.trim()) {
            setEmailError('Email address is required when email notifications are enabled')
            return
        }

        if (
            preferences.emailEnabled &&
            preferences.emailAddress.trim() &&
            !validateEmail(preferences.emailAddress.trim())
        ) {
            setEmailError('Invalid email address format')
            return
        }

        if (webhookError) return

        // Validate telegram if enabled
        if (preferences.telegramEnabled && !preferences.telegramChatId?.trim()) {
            setTelegramError('Telegram Chat ID is required when telegram notifications are enabled')
            return
        }

        setError(null)
        clearSuccessMessage()

        try {
            const submitted = preferences.webhookEnabled
                ? preferences
                : { ...preferences, webhookUrl: savedWebhookUrl }
            await saveMutation.mutateAsync(submitted)

            setPreferences(submitted)
            setOriginalPreferences(submitted)
            setSavedProviderActive(preferences.emailEnabled || preferences.webhookEnabled || preferences.telegramEnabled)
            showSuccessMessage('Preferences saved successfully')
            // Save becomes disabled once nothing is unsaved; keep focus in the panel.
            if (focusIsOnBodyOr(saveButtonRef.current)) setFocusRequest('heading')
        } catch (err) {
            setError(webhookHasUnsavedChanges
                ? WEBHOOK_SAVE_ERROR
                : err instanceof Error ? err.message : 'Failed to save preferences')
            // Keep focus on Save so the user can retry, or move to Discard changes.
            if (focusIsOnBodyOr(saveButtonRef.current)) setFocusRequest('save')
        }
    }

    const handleDiscardChanges = () => {
        if (actionPending || !originalPreferences) return
        setPreferences(originalPreferences)
        setEmailError(null)
        setTelegramError(null)
        setError(null)
        saveMutation.reset()
        showSuccessMessage('Unsaved changes discarded. Your saved notification preferences are shown.')
        setFocusRequest('heading')
    }

    const handleUnsubscribeClick = () => {
        setShowUnsubscribeReason(true)
        setError(null)
        clearSuccessMessage()
    }

    const handleCancelUnsubscribe = () => {
        setShowUnsubscribeReason(false)
        setUnsubscribeReason('')
        setError(null)
    }

    const cancelUnsubscribeRef = useRef(handleCancelUnsubscribe)
    useEffect(() => {
        cancelUnsubscribeRef.current = handleCancelUnsubscribe
    })

    const actionPendingRef = useRef(actionPending)
    useEffect(() => {
        actionPendingRef.current = actionPending
    }, [actionPending])

    // Focus management for the unsubscribe dialog, following the pattern in
    // components/ui/Modal.tsx: move focus into the dialog when it opens, keep
    // Tab navigation inside it, let Escape abandon it, and return focus to the
    // invoking button when it closes.
    useEffect(() => {
        if (!showUnsubscribeReason) return

        const dialog = unsubscribeDialogRef.current
        if (!dialog) return

        const previouslyFocused = document.activeElement as HTMLElement | null
        dialog.focus()

        const getFocusableElements = (): HTMLElement[] => {
            const focusableSelectors = [
                'button:not([disabled])',
                '[href]',
                'input:not([disabled])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                '[tabindex]:not([tabindex="-1"])',
            ]
            return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelectors.join(',')))
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (!actionPendingRef.current) cancelUnsubscribeRef.current()
                return
            }
            if (e.key !== 'Tab') return

            const focusableElements = getFocusableElements()
            if (focusableElements.length === 0) {
                e.preventDefault()
                dialog.focus()
                return
            }

            const firstElement = focusableElements[0]
            const lastElement = focusableElements[focusableElements.length - 1]
            const active = document.activeElement as HTMLElement | null
            const activeIndex = active ? focusableElements.indexOf(active) : -1

            if (activeIndex === -1) {
                e.preventDefault()
                if (e.shiftKey) {
                    lastElement.focus()
                } else {
                    firstElement.focus()
                }
                return
            }

            if (e.shiftKey) {
                if (active === firstElement) {
                    e.preventDefault()
                    lastElement.focus()
                }
            } else if (active === lastElement) {
                e.preventDefault()
                firstElement.focus()
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            const trigger = unsubscribeTriggerRef.current
            if (trigger && document.contains(trigger)) {
                trigger.focus()
            } else if (previouslyFocused && document.contains(previouslyFocused)) {
                previouslyFocused.focus()
            }
        }
    }, [showUnsubscribeReason])

    const handleUnsubscribe = async (includeReason: boolean) => {
        if (actionPending) return

        setError(null)
        clearSuccessMessage()
        const reason = includeReason ? unsubscribeReason.trim() : undefined

        try {
            await unsubscribeMutation.mutateAsync(reason)

            setPreferences(prev => ({
                ...prev,
                emailEnabled: false,
                webhookEnabled: false,
                telegramEnabled: false,
            }))
            setOriginalPreferences(prev =>
                prev
                    ? {
                          ...prev,
                          emailEnabled: false,
                          webhookEnabled: false,
                          telegramEnabled: false,
                      }
                    : null
            )
            setSavedProviderActive(false)
            setShowUnsubscribeReason(false)
            setUnsubscribeReason('')

            showSuccessMessage('Unsubscribed from all notifications')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to unsubscribe')
        }
    }

    const handleExport = async (format: 'json' | 'csv' | 'pdf') => {
        if (!portfolioId) return
        setExporting(format)
        try {
            await downloadPortfolioExport(portfolioId, format)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Export failed')
        } finally {
            setExporting(null)
        }
    }

    const hasUnsavedChanges = () => {
        if (!originalPreferences) return false
        return JSON.stringify(preferences) !== JSON.stringify(originalPreferences)
    }

    const enabledChannels = [
        { name: 'Email', enabled: preferences.emailEnabled },
        { name: 'Webhook', enabled: preferences.webhookEnabled },
        { name: 'Telegram', enabled: preferences.telegramEnabled },
    ].filter(channel => channel.enabled)
    const enabledChannelCount = enabledChannels.length
    const channelSelectionMessage =
        enabledChannelCount === 0
            ? '0 of 3 notification channels enabled. No notifications will be delivered with this selection. You can save with all channels off; test delivery requires at least one saved channel.'
            : enabledChannelCount === 1
              ? `1 of 3 notification channels enabled: ${enabledChannels[0].name} only. Notifications will be delivered only through ${enabledChannels[0].name}.`
              : `${enabledChannelCount} of 3 notification channels enabled: ${enabledChannels.map(channel => channel.name).join(', ')}.`
    const channelSelectionStatus = hasUnsavedChanges()
        ? `${channelSelectionMessage} Changes take effect after saving; test delivery uses saved settings until then.`
        : channelSelectionMessage

    const emailHasUnsavedChanges = !!originalPreferences && (
        preferences.emailEnabled !== originalPreferences.emailEnabled ||
        preferences.emailAddress !== originalPreferences.emailAddress
    )
    const webhookHasUnsavedChanges = !!originalPreferences && (
        preferences.webhookEnabled !== originalPreferences.webhookEnabled ||
        preferences.webhookUrl !== originalPreferences.webhookUrl
    )
    const telegramHasUnsavedChanges = !!originalPreferences && (
        preferences.telegramEnabled !== originalPreferences.telegramEnabled ||
        preferences.telegramChatId !== originalPreferences.telegramChatId
    )
    const eventsHaveUnsavedChanges = !!originalPreferences &&
        JSON.stringify(preferences.events) !== JSON.stringify(originalPreferences.events)
    const saveErrorMessage =
        saveMutation.microstate.phase === 'error'
            ? webhookHasUnsavedChanges
                ? WEBHOOK_SAVE_ERROR
                : saveMutation.microstate.description
            : null
    const unsubscribeErrorMessage =
        unsubscribeMutation.microstate.phase === 'error' ? unsubscribeMutation.microstate.description : null
    const actionStatus = savePending
        ? saveMutation.microstate.label
        : unsubscribePending
          ? unsubscribeMutation.microstate.label
          : null
    const displayedError = error || saveErrorMessage || unsubscribeErrorMessage || loadErrMsg
    // A failed save leaves the edited (optimistic) values on screen. Tell the
    // user they are not saved and how to retry or abandon them.
    const saveFailed = saveMutation.microstate.phase === 'error' && hasUnsavedChanges()
    const noChannelsEnabled = enabledChannelCount === 0
    const saveBlocked =
        !hasUnsavedChanges() ||
        (preferences.webhookEnabled && !!webhookError) ||
        (preferences.emailEnabled && !!emailError) ||
        (preferences.telegramEnabled && !!telegramError)

    if (loading) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-center py-8">
                    <Loader className="w-6 h-6 animate-spin text-blue-500" />
                    <span className="ml-2 text-gray-600">Loading preferences...</span>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm min-w-0">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
                <div className="flex items-center min-w-0">
                    <Bell className="w-6 h-6 text-blue-600 mr-2 flex-shrink-0" />
                    <h2
                        ref={headingRef}
                        tabIndex={-1}
                        className="text-xl font-semibold text-gray-900 break-words min-w-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                        Notifications
                    </h2>
                </div>
                {hasUnsavedChanges() && (
                    <span className="text-sm text-orange-600 font-medium break-words">Unsaved changes</span>
                )}
            </div>

            {/* Error Message */}
            {displayedError && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    id={SAVE_ERROR_ID}
                    className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-800 min-w-0"
                    role="alert"
                >
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="text-sm break-words min-w-0">
                        {displayedError}
                        {saveFailed && <> {SAVE_FAILURE_GUIDANCE}</>}
                    </span>
                </motion.div>
            )}

            {/* Success Message */}
            {successMessage && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2 text-green-800 min-w-0"
                    role="status"
                    aria-live="polite"
                >
                    <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span className="text-sm break-words min-w-0">{successMessage}</span>
                </motion.div>
            )}

            {actionStatus && (
                <div
                    className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 flex items-start gap-2 min-w-0"
                    role="status"
                    aria-live="polite"
                >
                    <Loader className="w-4 h-4 animate-spin flex-shrink-0 mt-0.5" />
                    <span className="break-words min-w-0">{actionStatus}</span>
                </div>
            )}

            {/* Export my data (GDPR) */}
            <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
                <div className="flex items-center mb-2">
                    <Download className="w-5 h-5 text-gray-600 mr-2" />
                    <span className="font-medium text-gray-900">Export your data</span>
                </div>
                <p className="text-sm text-gray-600 mb-3">
                    Download your portfolio data and rebalance history (GDPR right-to-data).
                </p>
                {portfolioId ? (
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => handleExport('json')}
                            disabled={!!exporting}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                        >
                            {exporting === 'json' ? '…' : 'JSON'}
                        </button>
                        <button
                            onClick={() => handleExport('csv')}
                            disabled={!!exporting}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                        >
                            {exporting === 'csv' ? '…' : 'CSV'}
                        </button>
                        <button
                            onClick={() => handleExport('pdf')}
                            disabled={!!exporting}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                        >
                            {exporting === 'pdf' ? '…' : 'PDF'}
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">Connect your wallet and open a portfolio to export from the Overview tab.</p>
                )}
            </div>


            {/* Provider Configuration */}
            <div className="space-y-6 mb-6">
                <p id="notification-channel-status" className="text-sm text-gray-600" role="status" aria-live="polite">
                    {channelSelectionStatus}
                </p>
                {/* Email Provider */}
                <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                            <Mail className="w-5 h-5 text-gray-600 mr-2" />
                            <span className="font-medium text-gray-900">Email Notifications</span>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={preferences.emailEnabled}
                            aria-label="Email notifications"
                            aria-describedby="notification-email-description notification-email-status"
                            onClick={() => {
                                setPreferences(prev => {
                                    const nextEnabled = !prev.emailEnabled
                                    if (!nextEnabled) setEmailError(null)
                                    return { ...prev, emailEnabled: nextEnabled }
                                })
                            }}
                            disabled={actionPending}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                preferences.emailEnabled ? 'bg-blue-600' : 'bg-gray-300'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    preferences.emailEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <p id="notification-email-description" className="text-sm text-gray-600 mb-3">
                        Receive notifications via email (requires SMTP configuration)
                    </p>
                    <p
                        id="notification-email-status"
                        className={`mb-3 text-xs ${
                            savePending && emailHasUnsavedChanges
                                ? 'text-blue-600'
                                : emailHasUnsavedChanges
                                  ? 'text-orange-600'
                                  : 'text-gray-500'
                        }`}
                        role={emailHasUnsavedChanges || savePending ? 'status' : undefined}
                        aria-live="polite"
                    >
                        {savePending && emailHasUnsavedChanges
                            ? 'Saving email notification settings...'
                            : emailHasUnsavedChanges
                              ? 'Email notification changes are pending save.'
                              : 'Email notification settings are unchanged.'}
                    </p>

                    {preferences.emailEnabled && (
                        <div>
                            <label htmlFor="notification-email-address" className="block text-sm font-medium text-gray-700 mb-1">
                                Email Address
                            </label>
                            <input
                                id="notification-email-address"
                                type="email"
                                value={preferences.emailAddress}
                                onChange={(e) => handleEmailAddressChange(e.target.value)}
                                placeholder="your-email@example.com"
                                aria-required="true"
                                aria-invalid={Boolean(emailError)}
                                aria-describedby={emailError ? 'notification-email-help notification-email-error' : 'notification-email-help'}
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    emailError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {emailError && (
                                <p id="notification-email-error" role="alert" className="mt-1 text-sm text-red-600">{emailError}</p>
                            )}
                            <p id="notification-email-help" className="mt-1 text-xs text-gray-500">
                                Enter the email address where you want to receive notifications
                            </p>
                        </div>
                    )}
                </div>

                {/* Webhook Provider */}
                <div className="border border-gray-200 rounded-lg p-3 sm:p-4 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center min-w-0">
                            <Webhook className="w-5 h-5 text-gray-600 mr-2 flex-shrink-0" />
                            <span className="font-medium text-gray-900 break-words min-w-0">Webhook Notifications</span>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={preferences.webhookEnabled}
                            aria-label="Webhook notifications"
                            aria-describedby="notification-webhook-description notification-webhook-status"
                            onClick={() => setPreferences(prev => ({ ...prev, webhookEnabled: !prev.webhookEnabled }))}
                            disabled={actionPending}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                                preferences.webhookEnabled ? 'bg-blue-600' : 'bg-gray-300'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    preferences.webhookEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <p id="notification-webhook-description" className="text-sm text-gray-600 mb-3 break-words">
                        Send notifications to your webhook endpoint via HTTP POST
                    </p>
                    <p
                        id="notification-webhook-status"
                        className={`mb-3 text-xs break-words ${
                            savePending && webhookHasUnsavedChanges
                                ? 'text-blue-600'
                                : webhookHasUnsavedChanges
                                  ? 'text-orange-600'
                                  : 'text-gray-500'
                        }`}
                        role="status"
                        aria-live="polite"
                    >
                        {savePending && webhookHasUnsavedChanges
                            ? 'Saving webhook notification settings...'
                            : preferences.webhookEnabled && webhookUrlChanged
                              ? savedWebhookActive
                                  ? 'Replacement endpoint pending. Delivery uses the saved endpoint until you save.'
                                  : 'New endpoint pending. Save to enable delivery.'
                              : webhookHasUnsavedChanges
                                ? 'Webhook notification changes are pending save.'
                                : savedWebhookActive
                                  ? 'Saved webhook endpoint active.'
                                  : 'Webhook delivery is off.'}
                    </p>

                    {preferences.webhookEnabled && (
                        <div className="min-w-0">
                            <label htmlFor="notification-webhook-url" className="block text-sm font-medium text-gray-700 mb-1 break-words">
                                Callback URL
                            </label>
                            <input
                                id="notification-webhook-url"
                                type="password"
                                inputMode="url"
                                autoComplete="off"
                                spellCheck={false}
                                value={webhookUrl}
                                disabled={actionPending}
                                aria-required="true"
                                aria-invalid={Boolean(webhookError)}
                                aria-describedby={webhookError ? 'webhook-url-help webhook-url-error' : 'webhook-url-help'}
                                onChange={(e) => setPreferences(prev => ({ ...prev, webhookUrl: e.target.value }))}
                                placeholder="https://your-domain.com/webhook"
                                className={`w-full min-w-0 max-w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    webhookError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {webhookError && (
                                <p id="webhook-url-error" role="alert" className="mt-1 text-sm text-red-600 break-words">{webhookError}</p>
                            )}
                            <p id="webhook-url-help" className="mt-1 text-xs text-gray-500 break-words">
                                Enter a complete URL starting with http:// or https://. To rotate the endpoint, replace the URL and save.
                            </p>
                        </div>
                    )}
                </div>

                {/* Telegram Provider */}
                <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                            <span aria-hidden="true" className="w-5 h-5 flex items-center justify-center text-gray-600 mr-2 font-bold">TG</span>
                            <span className="font-medium text-gray-900">Telegram Notifications</span>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={preferences.telegramEnabled}
                            aria-label="Telegram notifications"
                            aria-describedby="notification-telegram-description notification-telegram-status"
                            onClick={() => {
                                setPreferences(prev => {
                                    const nextEnabled = !prev.telegramEnabled
                                    if (!nextEnabled) setTelegramError(null)
                                    return { ...prev, telegramEnabled: nextEnabled }
                                })
                            }}
                            disabled={actionPending}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                preferences.telegramEnabled ? 'bg-blue-600' : 'bg-gray-300'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    preferences.telegramEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <p id="notification-telegram-description" className="text-sm text-gray-600 mb-3">
                        Send notifications to your Telegram chat via bot
                    </p>
                    <p
                        id="notification-telegram-status"
                        className={`mb-3 text-xs ${
                            savePending && telegramHasUnsavedChanges
                                ? 'text-blue-600'
                                : telegramHasUnsavedChanges
                                  ? 'text-orange-600'
                                  : 'text-gray-500'
                        }`}
                        role={telegramHasUnsavedChanges || savePending ? 'status' : undefined}
                        aria-live="polite"
                    >
                        {savePending && telegramHasUnsavedChanges
                            ? 'Saving Telegram notification settings...'
                            : telegramHasUnsavedChanges
                              ? 'Telegram notification changes are pending save.'
                              : 'Telegram notification settings are unchanged.'}
                    </p>

                    {preferences.telegramEnabled && (
                        <div>
                            <label htmlFor="notification-telegram-chat-id" className="block text-sm font-medium text-gray-700 mb-1">
                                Telegram Chat ID
                            </label>
                            <input
                                id="notification-telegram-chat-id"
                                type="text"
                                value={preferences.telegramChatId}
                                onChange={(e) => handleTelegramChatIdChange(e.target.value)}
                                placeholder="123456789"
                                aria-required="true"
                                aria-invalid={Boolean(telegramError)}
                                aria-describedby={telegramError ? 'notification-telegram-help notification-telegram-error' : 'notification-telegram-help'}
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    telegramError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {telegramError && (
                                <p id="notification-telegram-error" role="alert" className="mt-1 text-sm text-red-600">{telegramError}</p>
                            )}
                            <p id="notification-telegram-help" className="mt-1 text-xs text-gray-500">
                                Your Telegram User ID or Group Chat ID
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Event Toggles */}
            <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Event Types</h3>
                <p
                    className={`mb-3 text-xs ${
                        savePending && eventsHaveUnsavedChanges
                            ? 'text-blue-600'
                            : eventsHaveUnsavedChanges
                              ? 'text-orange-600'
                              : 'text-gray-500'
                    }`}
                    role={eventsHaveUnsavedChanges || savePending ? 'status' : undefined}
                    aria-live="polite"
                >
                    {savePending && eventsHaveUnsavedChanges
                        ? 'Saving event notification choices...'
                        : eventsHaveUnsavedChanges
                          ? 'Event notification changes are pending save.'
                          : 'Event notification choices are unchanged.'}
                </p>
                <div className="space-y-3">
                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Rebalance Alerts</div>
                            <div id="notification-event-rebalance-description" className="text-sm text-gray-600">
                                Notify when portfolio is rebalanced
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                       
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.rebalance}
                                aria-describedby="notification-event-rebalance-description"
                                aria-label="Rebalance alerts"
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, rebalance: !prev.events.rebalance }
                                }))}
                                disabled={actionPending}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.rebalance ? 'bg-blue-600' : 'bg-gray-300'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.rebalance ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Circuit Breaker Alerts</div>
                            <div id="notification-event-circuitBreaker-description" className="text-sm text-gray-600">
                                Notify when circuit breakers are triggered
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.circuitBreaker}
                                aria-describedby="notification-event-circuitBreaker-description"
                                aria-label="Circuit breaker alerts"
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, circuitBreaker: !prev.events.circuitBreaker }
                                }))}
                                disabled={actionPending}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.circuitBreaker ? 'bg-blue-600' : 'bg-gray-300'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.circuitBreaker ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Large Price Movement Alerts</div>
                            <div id="notification-event-priceMovement-description" className="text-sm text-gray-600">
                                Notify when asset prices move significantly
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.priceMovement}
                                aria-describedby="notification-event-priceMovement-description"
                                aria-label="Large price movement alerts"
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, priceMovement: !prev.events.priceMovement }
                                }))}
                                disabled={actionPending}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.priceMovement ? 'bg-blue-600' : 'bg-gray-300'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.priceMovement ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Risk Level Change Alerts</div>
                            <div id="notification-event-riskChange-description" className="text-sm text-gray-600">
                                Notify when portfolio risk level changes
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.riskChange}
                                aria-describedby="notification-event-riskChange-description"
                                aria-label="Risk level change alerts"
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, riskChange: !prev.events.riskChange }
                                }))}
                                disabled={actionPending}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.riskChange ? 'bg-blue-600' : 'bg-gray-300'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.riskChange ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>

        
            </div>

            {/* Digest Mode */}
            <div className="mb-6 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
                        <Bell className="w-5 h-5 text-gray-600 mr-2" />
                        <span className="font-medium text-gray-900">Digest Mode</span>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.digestEnabled}
                        aria-label="Digest mode"
                        aria-describedby="notification-digest-description"
                        onClick={() => {
                            setPreferences(prev => ({
                                ...prev,
                                digestEnabled: !prev.digestEnabled,
                                digestFrequency: !prev.digestEnabled ? 'daily' : 'realtime',
                            }))
                        }}
                        disabled={actionPending}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            preferences.digestEnabled ? 'bg-blue-600' : 'bg-gray-300'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                preferences.digestEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>
                <p id="notification-digest-description" className="text-sm text-gray-600 mb-3">
                    Group notifications into a single daily or weekly summary instead of sending them in real time.
                </p>

                {preferences.digestEnabled && (
                    <div>
                        <span id="notification-digest-frequency-label" className="block text-sm font-medium text-gray-700 mb-2">
                            Digest Frequency
                        </span>
                        <div
                            role="group"
                            aria-labelledby="notification-digest-frequency-label"
                            aria-describedby="notification-digest-frequency-help"
                            className="flex flex-col sm:flex-row gap-2"
                        >
                            {(['daily', 'weekly'] as const).map((freq) => (
                                <button
                                    key={freq}
                                    type="button"
                                    aria-pressed={preferences.digestFrequency === freq}
                                    onClick={() => setPreferences(prev => ({ ...prev, digestFrequency: freq }))}
                                    disabled={actionPending}
                                    className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                                        preferences.digestFrequency === freq
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {freq === 'daily' ? 'Daily' : 'Weekly'}
                                </button>
                            ))}
                        </div>
                        <p id="notification-digest-frequency-help" className="mt-2 text-xs text-gray-500">
                            {preferences.digestFrequency === 'daily'
                                ? 'Receive one summary per day with all events.'
                                : 'Receive one summary per week with all events.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Inline notification test delivery */}
            <NotificationTest
                userId={userId}
                hasConfiguredProvider={savedProviderActive}
            />

            {/* Action Buttons */}
            {showUnsubscribeReason && (
                <div
                    ref={unsubscribeDialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="unsubscribe-reason-title"
                    aria-describedby="unsubscribe-reason-description"
                    tabIndex={-1}
                    className="mb-4 p-4 border border-red-200 rounded-lg bg-red-50"
                >
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h3 id="unsubscribe-reason-title" className="text-sm font-semibold text-red-900">
                                Before you unsubscribe
                            </h3>
                            <p id="unsubscribe-reason-description" className="mt-1 text-sm text-red-800">
                                Sharing why is optional and helps us improve notifications.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleCancelUnsubscribe}
                            disabled={actionPending}
                            className="text-sm font-medium text-red-700 hover:text-red-900 disabled:text-gray-400"
                        >
                            Cancel
                        </button>
                    </div>

                    <label htmlFor="unsubscribe-reason" className="block text-sm font-medium text-red-900 mb-1">
                        Reason (optional)
                    </label>
                    <textarea
                        id="unsubscribe-reason"
                        value={unsubscribeReason}
                        onChange={(e) => setUnsubscribeReason(e.target.value.slice(0, 280))}
                        rows={3}
                        maxLength={280}
                        disabled={actionPending}
                        placeholder="Too many notifications, not relevant, or another reason"
                        className="w-full px-3 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100"
                    />
                    <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <span className="text-xs text-red-700">{unsubscribeReason.length}/280</span>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <button
                                type="button"
                                onClick={() => handleUnsubscribe(false)}
                                disabled={actionPending}
                                className="px-4 py-2 text-sm font-medium border border-red-200 rounded-lg text-red-700 hover:bg-red-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                            >
                                Skip and unsubscribe
                            </button>
                            <button
                                type="button"
                                onClick={() => handleUnsubscribe(true)}
                                disabled={actionPending}
                                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg"
                            >
                                {unsubscribePending ? 'Unsubscribing...' : 'Unsubscribe'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200 min-w-0">
                <div className="flex flex-col gap-1 min-w-0">
                    <button
                        type="button"
                        ref={unsubscribeTriggerRef}
                        onClick={handleUnsubscribeClick}
                        disabled={actionPending || showUnsubscribeReason || noChannelsEnabled}
                        aria-describedby={noChannelsEnabled ? 'unsubscribe-all-hint' : undefined}
                        className="text-sm text-left sm:text-center break-words text-red-600 hover:text-red-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                        Unsubscribe from all
                    </button>
                    {noChannelsEnabled && (
                        <span id="unsubscribe-all-hint" className="text-xs text-gray-500 break-words">
                            All notification channels are off.
                        </span>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                    {hasUnsavedChanges() && (
                        <button
                            type="button"
                            onClick={handleDiscardChanges}
                            disabled={actionPending}
                            className="w-full sm:w-auto px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed break-words"
                        >
                            Discard changes
                        </button>
                    )}
                    {/* While saving, Save stays focusable (aria-disabled) so keyboard focus is not dropped to <body>. */}
                    <button
                        type="button"
                        ref={saveButtonRef}
                        onClick={handleSave}
                        disabled={!savePending && (actionPending || saveBlocked)}
                        aria-disabled={savePending || undefined}
                        aria-describedby={displayedError ? `${SAVE_ERROR_ID} notification-channel-status` : 'notification-channel-status'}
                        className="w-full sm:w-auto flex flex-wrap items-center justify-center gap-2 px-4 sm:px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed aria-disabled:bg-gray-300 aria-disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-center break-words"
                    >
                        {savePending ? (
                            <>
                                <Loader className="w-4 h-4 animate-spin flex-shrink-0" aria-hidden="true" />
                                <span>Saving preferences...</span>
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                <span>Save Preferences</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default NotificationPreferences
