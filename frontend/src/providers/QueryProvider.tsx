import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { type ReactNode, useEffect } from 'react'
import { ApiClientError } from '../config/api'
import {
    shouldRefetchQueryOnWindowFocus,
    subscribeReconnectRefetch,
} from '../lib/queryOnlineSync'

const isQueryDevtoolsEnabled =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_QUERY_DEVTOOLS === 'true'

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: (failureCount, error) => {
                if (error instanceof ApiClientError && error.status === 401) {
                    return false
                }

                return failureCount < 3
            },
            staleTime: 30000,
            networkMode: 'offlineFirst',
            refetchOnWindowFocus: (query) => shouldRefetchQueryOnWindowFocus(query),
            refetchOnReconnect: false,
        },
    },
})

function QueryReconnectListener() {
    useEffect(() => subscribeReconnectRefetch(queryClient), [])
    return null
}

export const QueryProvider = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <QueryReconnectListener />
        {children}
        {isQueryDevtoolsEnabled ? (
            <ReactQueryDevtools initialIsOpen={false} />
        ) : null}
    </QueryClientProvider>
)
