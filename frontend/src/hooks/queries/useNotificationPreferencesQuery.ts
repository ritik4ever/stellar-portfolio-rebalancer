import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export interface NotificationEventPreferences {
    rebalance: boolean
    circuitBreaker: boolean
    priceMovement: boolean
    riskChange: boolean
}

export interface NotificationPreferencesModel {
    emailEnabled: boolean
    emailAddress: string
    webhookEnabled: boolean
    webhookUrl: string
    events: NotificationEventPreferences
}

export const notificationKeys = {
    all: ['notifications'] as const,
    preferences: (userId: string) => [...notificationKeys.all, 'preferences', userId] as const,
}

export function useNotificationPreferencesQuery(userId: string) {
    return useQuery({
        queryKey: notificationKeys.preferences(userId),
        queryFn: () =>
            api.get<{ preferences: NotificationPreferencesModel | null; message?: string }>(
                ENDPOINTS.NOTIFICATIONS_PREFERENCES,
                { userId }
            ),
        enabled: !!userId,
    })
}
