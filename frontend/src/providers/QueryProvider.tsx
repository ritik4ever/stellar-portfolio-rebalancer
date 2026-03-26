import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ReactNode } from 'react'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 3,
            staleTime: 30000, // 30 seconds
            refetchOnWindowFocus: true,
        },
    },
})

export const QueryProvider = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
)
