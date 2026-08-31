import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'
import { notificationKeys } from '../queries/useNotificationPreferencesQuery'
import type { NotificationPreferencesModel } from '../queries/useNotificationPreferencesQuery'

export type NotificationMutationPhase = 'idle' | 'pending' | 'success' | 'error'
export type NotificationEventType = 'rebalance' | 'circuitBreaker' | 'priceMovement' | 'riskChange'

export interface NotificationMutationMicrostate {
    phase: NotificationMutationPhase
    label: string
    description: string
    errorMessage?: string
}

type MutationStateInput = {
    status: NotificationMutationPhase
    error: unknown
}

type MutationCopy = Record<NotificationMutationPhase, string>

export interface NotificationTestPayload {
    userId: string
    eventType: NotificationEventType
}

export interface NotificationTestResponse {
    message: string
    sentTo: {
        email: string | null
        webhook: string | null
        telegram: string | null
    }
    timestamp: string
}

export interface NotificationTestAllResponse {
    results: Array<{
        eventType: NotificationEventType
        success: boolean
        error?: string
        sentTo?: {
            email: string | null
            webhook: string | null
            telegram: string | null
        }
        timestamp: string
    }>
}

export function getNotificationMutationError(error: unknown): string | undefined {
    if (!error) return undefined
    return error instanceof Error ? error.message : String(error)
}

export function getNotificationMutationMicrostate(
    mutation: MutationStateInput,
    labels: MutationCopy
): NotificationMutationMicrostate {
    const errorMessage = getNotificationMutationError(mutation.error)
    return {
        phase: mutation.status,
        label: labels[mutation.status],
        description: errorMessage && mutation.status === 'error'
            ? `${labels.error}: ${errorMessage}`
            : labels[mutation.status],
        errorMessage,
    }
}

export function useSaveNotificationPreferencesMutation(userId: string) {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: (preferences: NotificationPreferencesModel) =>
            api.post(ENDPOINTS.NOTIFICATIONS_SUBSCRIBE, {
                userId,
                ...preferences,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: notificationKeys.preferences(userId) })
        },
    })

    return {
        ...mutation,
        microstate: getNotificationMutationMicrostate(mutation, {
            idle: 'Ready to save notification preferences',
            pending: 'Saving notification preferences',
            success: 'Notification preferences saved',
            error: 'Could not save notification preferences',
        }),
    }
}

export function useUnsubscribeNotificationsMutation(userId: string) {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: (reason?: string) => {
            const trimmedReason = reason?.trim()
            return api.delete(ENDPOINTS.NOTIFICATIONS_UNSUBSCRIBE(userId, trimmedReason))
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: notificationKeys.preferences(userId) })
        },
    })

    return {
        ...mutation,
        microstate: getNotificationMutationMicrostate(mutation, {
            idle: 'Ready to unsubscribe from notifications',
            pending: 'Unsubscribing from notifications',
            success: 'Unsubscribed from notifications',
            error: 'Could not unsubscribe from notifications',
        }),
    }
}

export function useSendTestNotificationMutation() {
    const mutation = useMutation({
        mutationFn: ({ userId, eventType }: NotificationTestPayload) =>
            api.post<NotificationTestResponse>(ENDPOINTS.NOTIFICATIONS_TEST, {
                userId,
                eventType,
            }),
    })

    return {
        ...mutation,
        microstate: getNotificationMutationMicrostate(mutation, {
            idle: 'Ready to send test notification',
            pending: 'Sending test notification',
            success: 'Test notification sent',
            error: 'Could not send test notification',
        }),
    }
}

export function useSendAllTestNotificationsMutation() {
    const mutation = useMutation({
        mutationFn: (userId: string) =>
            api.post<NotificationTestAllResponse>(ENDPOINTS.NOTIFICATIONS_TEST_ALL, { userId }),
    })

    return {
        ...mutation,
        microstate: getNotificationMutationMicrostate(mutation, {
            idle: 'Ready to test all notifications',
            pending: 'Testing all notification types',
            success: 'All notification tests completed',
            error: 'Could not test all notifications',
        }),
    }
}

export type EventType = 'rebalance' | 'circuitBreaker' | 'priceMovement' | 'riskChange'

export interface TestNotificationResult {
    message: string
    sentTo: {
        email: string | null
        webhook: string | null
        telegram: string | null
    }
    timestamp: string
}

export function useTestNotificationMutation(userId: string) {
    const mutation = useMutation({
        mutationFn: (eventType: EventType) =>
            api.post<TestNotificationResult>(ENDPOINTS.NOTIFICATIONS_TEST, {
                userId,
                eventType,
            }),
    })

    return {
        ...mutation,
        microstate: getNotificationMutationMicrostate(mutation, {
            idle: 'Ready to send test notification',
            pending: 'Sending test notification',
            success: 'Test notification sent',
            error: 'Could not send test notification',
        }),
    }
}

export interface TestAllNotificationResult {
    results: Array<{
        eventType: EventType
        success: boolean
        error?: string
        sentTo?: { email: string | null; webhook: string | null; telegram: string | null }
        timestamp: string
    }>
}

export function useTestAllNotificationsMutation(userId: string) {
    const mutation = useMutation({
        mutationFn: () =>
            api.post<TestAllNotificationResult>(ENDPOINTS.NOTIFICATIONS_TEST_ALL, { userId }),
    })

    return {
        ...mutation,
        microstate: getNotificationMutationMicrostate(mutation, {
            idle: 'Ready to test all notifications',
            pending: 'Testing all notification types',
            success: 'All notification tests completed',
            error: 'Could not test all notifications',
        }),
    }
}
