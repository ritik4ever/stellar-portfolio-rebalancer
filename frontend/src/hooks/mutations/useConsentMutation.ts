import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const consentKeys = {
    all: ['consent'] as const,
    status: (userId: string) => [...consentKeys.all, 'status', userId] as const,
}

type ConsentStatus = {
    accepted: boolean
}

type ConsentMutationContext = {
    previous: ConsentStatus | undefined
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
        onMutate: async (): Promise<ConsentMutationContext> => {
            await queryClient.cancelQueries({ queryKey: consentKeys.status(userId) })
            const previous = queryClient.getQueryData<ConsentStatus>(consentKeys.status(userId))
            queryClient.setQueryData<ConsentStatus>(consentKeys.status(userId), { accepted: true })
            return { previous }
        },
        onError: (_error, _variables, context) => {
            queryClient.setQueryData(consentKeys.status(userId), context?.previous)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: consentKeys.status(userId) })
        },
    })
}

export function useRevokeConsentMutation(userId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: () => api.delete(ENDPOINTS.USER_DATA_DELETE(userId)),
        onMutate: async (): Promise<ConsentMutationContext> => {
            await queryClient.cancelQueries({ queryKey: consentKeys.status(userId) })
            const previous = queryClient.getQueryData<ConsentStatus>(consentKeys.status(userId))
            queryClient.setQueryData<ConsentStatus>(consentKeys.status(userId), { accepted: false })
            return { previous }
        },
        onError: (_error, _variables, context) => {
            queryClient.setQueryData(consentKeys.status(userId), context?.previous)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: consentKeys.status(userId) })
        },
    })
}
