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
