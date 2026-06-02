import { onlineManager, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query'

export const RECONNECT_REFETCH_ROOT_KEYS = new Set(['portfolios', 'prices'])

export function isReconnectRefetchQueryKey(queryKey: QueryKey): boolean {
    const root = queryKey[0]
    return typeof root === 'string' && RECONNECT_REFETCH_ROOT_KEYS.has(root)
}

export function shouldRefetchQueryOnWindowFocus(query: Query): boolean {
    if (!onlineManager.isOnline()) return false
    if (!isReconnectRefetchQueryKey(query.queryKey)) return false
    return query.isStale()
}

export async function refetchStaleReconnectQueries(queryClient: QueryClient): Promise<void> {
    await queryClient.refetchQueries({
        type: 'active',
        predicate: (query) =>
            isReconnectRefetchQueryKey(query.queryKey) && query.isStale(),
    })
}

export function subscribeReconnectRefetch(queryClient: QueryClient): () => void {
    return onlineManager.subscribe((isOnline) => {
        if (isOnline) {
            void refetchStaleReconnectQueries(queryClient)
        }
    })
}
