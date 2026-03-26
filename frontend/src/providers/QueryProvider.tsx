import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ReactNode } from "react";

const isQueryDevtoolsEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_QUERY_DEVTOOLS === "true";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 30000, // 30 seconds
      refetchOnWindowFocus: true,
    },
  },
});

export const QueryProvider = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
    {isQueryDevtoolsEnabled ? (
      <ReactQueryDevtools initialIsOpen={false} />
    ) : null}
  </QueryClientProvider>
);
