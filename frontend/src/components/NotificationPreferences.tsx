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
    events: {
        rebalance: true,
        circuitBreaker: true,
        priceMovement: true,
        riskChange: true,
    },
    digestEnabled: false,
    digestFrequency: 'realtime',
}

const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ userId, portfolioId }) => {
    const [preferences, setPreferences] = useState<Preferences>(defaultPreferences)

    const [originalPreferences, setOriginalPreferences] = useState<Preferences | null>(null)
    const { data: prefData, isLoading: loading, error: loadError } = useNotificationPreferencesQuery(userId)
    const saveMutation = useSaveNotificationPreferencesMutation(userId)
    const unsubscribeMutation = useUnsubscribeNotificationsMutation(userId)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [webhookError, setWebhookError] = useState<string | null>(null)
    const [emailError, setEmailError] = useState<string | null>(null)
    const [exporting, setExporting] = useState<'json' | 'csv' | 'pdf' | null>(null)
    const [savedProviderActive, setSavedProviderActive] = useState(false)
    const [showUnsubscribeReason, setShowUnsubscribeReason] = useState(false)
    const [unsubscribeReason, setUnsubscribeReason] = useState('')
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const savePending = saveMutation.microstate.phase === 'pending'
    const unsubscribePending = unsubscribeMutation.microstate.phase === 'pending'
    const actionPending = savePending || unsubscribePending

    useEffect(() => {
        if (!prefData) return
        if (prefData.preferences) {
            setPreferences(prefData.preferences)
            setOriginalPreferences(prefData.preferences)
            setSavedProviderActive(
                prefData.preferences.emailEnabled || prefData.preferences.webhookEnabled
            )
        } else {
            setPreferences(defaultPreferences)
            setOriginalPreferences(defaultPreferences)
            setSavedProviderActive(false)
        }
    }, [prefData])

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

    const validateWebhookUrl = (url: string): boolean => {
        if (!url) return true // Empty is valid when webhook is disabled

        try {
            const parsed = new URL(url)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        } catch {
            return false
        }
    }

    const validateEmail = (email: string): boolean => {
        if (!email) return true // Empty is valid when email is disabled
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }

    const handleEmailAddressChange = (email: string) => {
        setPreferences(prev => ({ ...prev, emailAddress: email }))
        if (email && !validateEmail(email)) {
            setEmailError('Invalid email address format')
        } else {
            setEmailError(null)
        }
    }

    const handleWebhookUrlChange = (url: string) => {
        setPreferences(prev => ({ ...prev, webhookUrl: url }))
        
        if (url && !validateWebhookUrl(url)) {
            setWebhookError('Invalid URL format. Must start with http:// or https://')
        } else {
            setWebhookError(null)
        }
    }

    const handleSave = async () => {
        // Validate email address if email is enabled
        if (preferences.emailEnabled && !preferences.emailAddress) {
            setEmailError('Email address is required when email notifications are enabled')
            return
        }

        if (
            preferences.emailEnabled &&
            preferences.emailAddress &&
            !validateEmail(preferences.emailAddress)
        ) {
            setEmailError('Invalid email address format')
            return
        }

        // Validate webhook URL if webhook is enabled
        if (preferences.webhookEnabled && !preferences.webhookUrl) {
            setWebhookError('Webhook URL is required when webhook notifications are enabled')
            return
        }

        if (
            preferences.webhookEnabled &&
            preferences.webhookUrl &&
            !validateWebhookUrl(preferences.webhookUrl)
        ) {
            setWebhookError('Invalid webhook URL format')
            return
        }

        setError(null)
        clearSuccessMessage()

        try {
            await saveMutation.mutateAsync(preferences)

            setOriginalPreferences(preferences)
            setSavedProviderActive(preferences.emailEnabled || preferences.webhookEnabled)
            showSuccessMessage('Preferences saved successfully')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save preferences')
        }
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
            }))
            setOriginalPreferences(prev =>
                prev
                    ? {
                          ...prev,
                          emailEnabled: false,
                          webhookEnabled: false,
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

    const emailHasUnsavedChanges = !!originalPreferences && (
        preferences.emailEnabled !== originalPreferences.emailEnabled ||
        preferences.emailAddress !== originalPreferences.emailAddress
    )
    const webhookHasUnsavedChanges = !!originalPreferences && (
        preferences.webhookEnabled !== originalPreferences.webhookEnabled ||
        preferences.webhookUrl !== originalPreferences.webhookUrl
    )
    const eventsHaveUnsavedChanges = !!originalPreferences &&
        JSON.stringify(preferences.events) !== JSON.stringify(originalPreferences.events)
    const saveErrorMessage =
        saveMutation.microstate.phase === 'error' ? saveMutation.microstate.description : null
    const unsubscribeErrorMessage =
        unsubscribeMutation.microstate.phase === 'error' ? unsubscribeMutation.microstate.description : null
    const actionStatus = savePending
        ? saveMutation.microstate.label
        : unsubscribePending
          ? unsubscribeMutation.microstate.label
          : null
    const displayedError = error || saveErrorMessage || unsubscribeErrorMessage || loadErrMsg

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
        <div className="bg-white rounded-xl p-6 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                    <Bell className="w-6 h-6 text-blue-600 mr-2" />
                    <h2 className="text-xl font-semibold text-gray-900">Notifications</h2>
                </div>
                {hasUnsavedChanges() && (
                    <span className="text-sm text-orange-600 font-medium">Unsaved changes</span>
                )}
            </div>

            {/* Error Message */}
            {displayedError && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-800"
                    role="alert"
                >
                    <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                    <span className="text-sm">{displayedError}</span>
                </motion.div>
            )}

            {/* Success Message */}
            {successMessage && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center text-green-800"
                    role="status"
                    aria-live="polite"
                >
                    <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                    <span className="text-sm">{successMessage}</span>
                </motion.div>
            )}

            {actionStatus && (
                <div
                    className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 flex items-center"
                    role="status"
                    aria-live="polite"
                >
                    <Loader className="w-4 h-4 mr-2 animate-spin flex-shrink-0" />
                    {actionStatus}
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
                            onClick={() => setPreferences(prev => ({ ...prev, emailEnabled: !prev.emailEnabled }))}
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
                    <p className="text-sm text-gray-600 mb-3">
                        Receive notifications via email (requires SMTP configuration)
                    </p>
                    <p
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
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={preferences.emailAddress}
                                onChange={(e) => handleEmailAddressChange(e.target.value)}
                                placeholder="your-email@example.com"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    emailError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {emailError && (
                                <p className="mt-1 text-sm text-red-600">{emailError}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                                Enter the email address where you want to receive notifications
                            </p>
                        </div>
                    )}
                </div>

                {/* Webhook Provider */}
                <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                            <Webhook className="w-5 h-5 text-gray-600 mr-2" />
                            <span className="font-medium text-gray-900">Webhook Notifications</span>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={preferences.webhookEnabled}
                            aria-label="Webhook notifications"
                            onClick={() => setPreferences(prev => ({ ...prev, webhookEnabled: !prev.webhookEnabled }))}
                            disabled={actionPending}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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
                    <p className="text-sm text-gray-600 mb-3">
                        Send notifications to your webhook endpoint via HTTP POST
                    </p>
                    <p
                        className={`mb-3 text-xs ${
                            savePending && webhookHasUnsavedChanges
                                ? 'text-blue-600'
                                : webhookHasUnsavedChanges
                                  ? 'text-orange-600'
                                  : 'text-gray-500'
                        }`}
                        role={webhookHasUnsavedChanges || savePending ? 'status' : undefined}
                        aria-live="polite"
                    >
                        {savePending && webhookHasUnsavedChanges
                            ? 'Saving webhook notification settings...'
                            : webhookHasUnsavedChanges
                              ? 'Webhook notification changes are pending save.'
                              : 'Webhook notification settings are unchanged.'}
                    </p>

                    {preferences.webhookEnabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Webhook URL
                            </label>
                            <input
                                type="url"
                                value={preferences.webhookUrl}
                                onChange={(e) => handleWebhookUrlChange(e.target.value)}
                                placeholder="https://your-domain.com/webhook"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    webhookError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {webhookError && (
                                <p className="mt-1 text-sm text-red-600">{webhookError}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                                Must be a valid HTTP or HTTPS URL
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
                            <div className="text-sm text-gray-600">
                                Notify when portfolio is rebalanced
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                       
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.rebalance}
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
                            <div className="text-sm text-gray-600">
                                Notify when circuit breakers are triggered
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.circuitBreaker}
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
                            <div className="text-sm text-gray-600">
                                Notify when asset prices move significantly
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.priceMovement}
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
                            <div className="text-sm text-gray-600">
                                Notify when portfolio risk level changes
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            
                            <button
                                type="button"
                                role="switch"
                                aria-checked={preferences.events.riskChange}
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
                <p className="text-sm text-gray-600 mb-3">
                    Group notifications into a single daily or weekly summary instead of sending them in real time.
                </p>

                {preferences.digestEnabled && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Digest Frequency
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            {(['daily', 'weekly'] as const).map((freq) => (
                                <button
                                    key={freq}
                                    type="button"
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
                        <p className="mt-2 text-xs text-gray-500">
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
                    role="dialog"
                    aria-labelledby="unsubscribe-reason-title"
                    className="mb-4 p-4 border border-red-200 rounded-lg bg-red-50"
                >
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h3 id="unsubscribe-reason-title" className="text-sm font-semibold text-red-900">
                                Before you unsubscribe
                            </h3>
                            <p className="mt-1 text-sm text-red-800">
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

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200">
                <button
                    type="button"
                    onClick={handleUnsubscribeClick}
                    disabled={actionPending || showUnsubscribeReason || (!preferences.emailEnabled && !preferences.webhookEnabled)}
                    className="text-sm text-red-600 hover:text-red-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    Unsubscribe from all
                </button>

                <button
                    onClick={handleSave}
                    disabled={actionPending || !hasUnsavedChanges() || (preferences.webhookEnabled && !!webhookError) || (preferences.emailEnabled && !!emailError)}
                    className="flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                    {savePending ? (
                        <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Saving preferences...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 mr-2" />
                            Save Preferences
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

export default NotificationPreferences
