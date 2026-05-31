import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'
import { notificationKeys } from '../queries/useNotificationPreferencesQuery'
import type { NotificationPreferencesModel } from '../queries/useNotificationPreferencesQuery'

export function useSaveNotificationPreferencesMutation(userId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (preferences: NotificationPreferencesModel) =>
            api.post(ENDPOINTS.NOTIFICATIONS_SUBSCRIBE, {
                userId,
                ...preferences,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: notificationKeys.preferences(userId) })
        },
    })
}

export function useUnsubscribeNotificationsMutation(userId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: () => api.delete(ENDPOINTS.NOTIFICATIONS_UNSUBSCRIBE(userId)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: notificationKeys.preferences(userId) })
        },
    })
}

export type EventType = 'rebalance' | 'circuitBreaker' | 'priceMovement' | 'riskChange'

export interface TestNotificationResult {
    message: string
    sentTo: {
        email: string | null
        webhook: string | null
    }
    timestamp: string
}

export function useTestNotificationMutation(userId: string) {
    return useMutation({
        mutationFn: (eventType: EventType) =>
            api.post<TestNotificationResult>(ENDPOINTS.NOTIFICATIONS_TEST, {
                userId,
                eventType,
            }),
    })
}

export interface TestAllNotificationResult {
    results: Array<{
        eventType: EventType
        success: boolean
        error?: string
        sentTo?: { email: string | null; webhook: string | null }
        timestamp: string
    }>
}

export function useTestAllNotificationsMutation(userId: string) {
    return useMutation({
        mutationFn: () =>
            api.post<TestAllNotificationResult>(ENDPOINTS.NOTIFICATIONS_TEST_ALL, { userId }),
    })
}
