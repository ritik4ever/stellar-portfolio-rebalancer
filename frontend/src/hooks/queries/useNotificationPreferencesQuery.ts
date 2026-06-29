import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export interface NotificationEventPreferences {
    rebalance: boolean
    circuitBreaker: boolean
    priceMovement: boolean
    riskChange: boolean
}

export type DigestFrequency = 'realtime' | 'daily' | 'weekly'

export interface NotificationPreferencesModel {
    emailEnabled: boolean
    emailAddress: string
    webhookEnabled: boolean
    webhookUrl: string
    telegramEnabled: boolean
    telegramChatId: string
    events: NotificationEventPreferences
    digestEnabled: boolean
    digestFrequency: DigestFrequency
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
