import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const consentKeys = {
    all: ['consent'] as const,
    status: (userId: string) => [...consentKeys.all, 'status', userId] as const,
}

export function useRecordConsentMutation(userId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: () =>
            api.post(ENDPOINTS.CONSENT_RECORD, {
                userId,
                terms: true,
                privacy: true,
                cookies: true,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: consentKeys.status(userId) })
        },
    })
}
