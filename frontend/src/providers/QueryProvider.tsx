import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { type ReactNode } from 'react'
import { ApiClientError } from '../config/api'

const isQueryDevtoolsEnabled =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_QUERY_DEVTOOLS === 'true'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: (failureCount, error) => {
                if (error instanceof ApiClientError && error.status === 401) {
                    return false
                }

                return failureCount < 3
            },
            staleTime: 30000, // 30 seconds
            refetchOnWindowFocus: true,
        },
    },
})

export const QueryProvider = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        {children}
        {isQueryDevtoolsEnabled ? (
            <ReactQueryDevtools initialIsOpen={false} />
        ) : null}
    </QueryClientProvider>
)
