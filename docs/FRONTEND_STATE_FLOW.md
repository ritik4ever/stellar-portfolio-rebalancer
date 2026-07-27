# Frontend State and Data Flow Architecture

This guide explains where server state, local state, and realtime state live in the frontend, and how data flows between them. Use this to understand cache boundaries, mutation patterns, and when to invalidate queries.

## Quick Reference

| State Type         | Location             | Ownership          | Lifetime           | Invalidation           |
| ------------------ | -------------------- | ------------------ | ------------------ | ---------------------- |
| **Server state**   | TanStack Query cache | Backend API        | Stale after 30-60s | Manual or auto-refetch |
| **Local state**    | React `useState`     | Component          | Until unmount      | Manual update          |
| **Realtime state** | WebSocket listeners  | Backend + frontend | Live updates       | Event-driven           |
| **UI state**       | React `useState`     | Component          | Until unmount      | User interaction       |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Components (UI State)                                   │  │
│  │  - Modal open/close, form input, loading spinners        │  │
│  │  - Managed with useState()                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hooks Layer (Query & Mutation)                          │  │
│  │  - usePortfolioDetails() → TanStack Query               │  │
│  │  - useExecuteRebalanceMutation() → TanStack Mutation    │  │
│  │  - Cache invalidation on success/error                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  TanStack Query Cache (Server State)                     │  │
│  │  - Stale time: 30-60 seconds                             │  │
│  │  - Retry: 3 attempts                                     │  │
│  │  - Refetch on window focus: enabled                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  API Client (frontend/src/config/api.ts)                │  │
│  │  - HTTP requests to /api/v1/*                            │  │
│  │  - Error handling and response parsing                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Backend API (Node.js)                        │
├─────────────────────────────────────────────────────────────────┤
│  - Serves /api/v1/* endpoints                                   │
│  - Manages database state                                       │
│  - Triggers queue jobs (rebalance, analytics)                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Query Ownership and Cache Keys

### Portfolio Queries

**Query key factory:** `frontend/src/hooks/queries/usePortfolioQuery.ts`

```typescript
export const portfolioKeys = {
  all: ["portfolios"] as const,
  lists: () => [...portfolioKeys.all, "list"] as const,
  list: (address: string) => [...portfolioKeys.lists(), address] as const,
  details: () => [...portfolioKeys.all, "detail"] as const,
  detail: (id: string) => [...portfolioKeys.details(), id] as const,
};
```

**Cache hierarchy:**

- `['portfolios']` — root key for all portfolio data
- `['portfolios', 'list', 'G...ADDRESS']` — user's portfolio list
- `['portfolios', 'detail', 'portfolio-123']` — single portfolio details

**Stale times:**

- Portfolio list: 1 minute (changes less frequently)
- Portfolio detail: 30 seconds (prices update often)
- Rebalance estimate: 25 seconds (refetch every 30s)

### When to Invalidate

Invalidation happens in mutation `onSuccess` and `onError` callbacks:

```typescript
export const useExecuteRebalanceMutation = (portfolioId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.post<any>(ENDPOINTS.PORTFOLIO_REBALANCE(portfolioId!)),
    onSuccess: () => {
      // Invalidate all related queries
      queryClient.invalidateQueries({
        queryKey: portfolioKeys.detail(portfolioId),
      });
      queryClient.invalidateQueries({
        queryKey: [...portfolioKeys.detail(portfolioId), "rebalance-estimate"],
      });
      queryClient.invalidateQueries({
        queryKey: historyKeys.list(portfolioId),
      });
      queryClient.invalidateQueries({
        queryKey: analyticsKeys.portfolio(portfolioId),
      });
    },
  });
};
```

**Rule:** After a mutation succeeds, invalidate all queries that depend on the mutated data. TanStack Query will refetch them automatically.

---

## Local State vs Server State

### Local State (useState)

Use `useState` for UI-only state that doesn't need to persist to the backend:

```typescript
// ✅ Good: UI state
const [isModalOpen, setIsModalOpen] = useState(false);
const [formInput, setFormInput] = useState("");
const [selectedTab, setSelectedTab] = useState("overview");

// ✅ Good: Temporary loading state
const [isSubmitting, setIsSubmitting] = useState(false);
```

### Server State (TanStack Query)

Use queries for data that comes from the backend:

```typescript
// ✅ Good: Server state
const { data: portfolio } = usePortfolioDetails(portfolioId);
const { data: rebalanceEstimate } = useRebalanceEstimate(portfolioId);

// ❌ Avoid: Duplicating server state in useState
const [portfolio, setPortfolio] = useState(null);
useEffect(() => {
  // Don't do this — use TanStack Query instead
  fetchPortfolio().then(setPortfolio);
}, []);
```

---

## Mutation Patterns

### Standard Mutation Flow

```typescript
const mutation = useExecuteRebalanceMutation(portfolioId);

const handleRebalance = async () => {
  try {
    // 1. Mutation starts (isPending = true)
    const result = await mutation.mutateAsync();

    // 2. Success: cache invalidated, queries refetch
    // 3. Component re-renders with fresh data

    showSuccessToast("Rebalance executed");
  } catch (error) {
    // 4. Error: cache invalidated, queries refetch
    showErrorToast(error.message);
  }
};
```

### Idempotency

Mutations that support `Idempotency-Key` header are safe to retry:

- `POST /api/portfolio` — create portfolio
- `POST /api/portfolio/:id/rebalance` — execute rebalance
- `POST /api/notifications/subscribe` — subscribe to notifications

The backend caches the response for 24 hours, so retries return the same result without side effects.

---

## Realtime State (WebSocket)

The backend supports WebSocket connections for live updates. When connected:

1. **Subscribe to portfolio updates:**

   ```typescript
   ws.send(
     JSON.stringify({
       type: "subscribe",
       channel: "portfolio:portfolio-123",
     }),
   );
   ```

2. **Listen for events:**

   ```typescript
   ws.onmessage = (event) => {
     const { type, data } = JSON.parse(event.data);
     if (type === "portfolio:updated") {
       // Invalidate cache to trigger refetch
       queryClient.invalidateQueries({
         queryKey: portfolioKeys.detail(data.id),
       });
     }
   };
   ```

3. **Unsubscribe when done:**
   ```typescript
   ws.send(
     JSON.stringify({
       type: "unsubscribe",
       channel: "portfolio:portfolio-123",
     }),
   );
   ```

---

## Common Workflows

### Load Portfolio Details

```typescript
function PortfolioPage({ portfolioId }: { portfolioId: string }) {
    // 1. Query server state
    const { data: portfolio, isLoading, error } = usePortfolioDetails(portfolioId)

    // 2. Local UI state
    const [isEditing, setIsEditing] = useState(false)

    if (isLoading) return <Spinner />
    if (error) return <ErrorBanner error={error} />

    return (
        <div>
            <h1>{portfolio.name}</h1>
            <button onClick={() => setIsEditing(!isEditing)}>
                {isEditing ? 'Done' : 'Edit'}
            </button>
        </div>
    )
}
```

### Execute Rebalance with Optimistic Update

```typescript
function RebalanceButton({ portfolioId }: { portfolioId: string }) {
    const queryClient = useQueryClient()
    const mutation = useExecuteRebalanceMutation(portfolioId)

    const handleRebalance = async () => {
        // 1. Optimistically update UI
        queryClient.setQueryData(
            portfolioKeys.detail(portfolioId),
            (old) => ({ ...old, isRebalancing: true })
        )

        try {
            // 2. Execute mutation
            await mutation.mutateAsync()

            // 3. Success: cache invalidated, queries refetch
            // (no need to manually update — mutation.onSuccess handles it)
        } catch (error) {
            // 4. Error: rollback optimistic update
            queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(portfolioId) })
        }
    }

    return (
        <button onClick={handleRebalance} disabled={mutation.isPending}>
            {mutation.isPending ? 'Rebalancing...' : 'Rebalance'}
        </button>
    )
}
```

### Subscribe to Notifications

```typescript
function NotificationPreferences({ userId }: { userId: string }) {
    const [webhookUrl, setWebhookUrl] = useState('')
    const subscribeMutation = useNotificationSubscribeMutation()

    const handleSubscribe = async () => {
        try {
            // 1. Mutation sends to backend
            await subscribeMutation.mutateAsync({
                userId,
                webhookUrl,
                events: { rebalance: true, priceMovement: true }
            })

            // 2. Success: cache invalidated
            // 3. Preferences query refetches
            showSuccessToast('Subscribed to notifications')
        } catch (error) {
            showErrorToast(error.message)
        }
    }

    return (
        <form onSubmit={(e) => { e.preventDefault(); handleSubscribe() }}>
            <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-domain.com/webhook"
            />
            <button type="submit" disabled={subscribeMutation.isPending}>
                Subscribe
            </button>
        </form>
    )
}
```

---

## Cache Invalidation Strategy

### Automatic Invalidation (Recommended)

Use mutation `onSuccess` callbacks to invalidate related queries:

```typescript
useMutation({
  mutationFn: (data) => api.post("/api/portfolio", data),
  onSuccess: () => {
    // Invalidate all portfolio queries
    queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
  },
});
```

### Manual Invalidation

For complex scenarios, manually invalidate specific queries:

```typescript
// Invalidate a single query
queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(portfolioId) });

// Invalidate all queries matching a pattern
queryClient.invalidateQueries({ queryKey: portfolioKeys.all });

// Invalidate and refetch immediately
queryClient.refetchQueries({ queryKey: portfolioKeys.detail(portfolioId) });
```

### Stale Time Tuning

Adjust stale times based on data freshness requirements:

```typescript
// Fast-changing data (prices, estimates)
staleTime: 25000, // 25 seconds

// Moderate-changing data (portfolio details)
staleTime: 30000, // 30 seconds

// Slow-changing data (user list)
staleTime: 60000, // 1 minute
```

---

## Debugging

### Enable React Query DevTools

Set `VITE_ENABLE_QUERY_DEVTOOLS=true` in `frontend/.env`:

```env
VITE_ENABLE_QUERY_DEVTOOLS=true
```

Then open the DevTools panel (bottom-right corner) to:

- Inspect cache state
- View query/mutation history
- Manually invalidate queries
- Replay mutations

### Common Issues

| Issue                            | Cause                   | Fix                                                    |
| -------------------------------- | ----------------------- | ------------------------------------------------------ |
| Data not updating after mutation | Cache not invalidated   | Add `onSuccess` callback to invalidate related queries |
| Stale data shown                 | Stale time too long     | Reduce `staleTime` or manually refetch                 |
| Duplicate requests               | Missing `enabled` check | Add `enabled: !!id` to prevent queries when ID is null |
| Memory leak warnings             | Queries not cleaned up  | Ensure `QueryProvider` wraps entire app                |

---

## Related Documentation

- [TanStack Query docs](https://tanstack.com/query/latest)
- [API reference](../API.md) — endpoint details and response schemas
- [Backend state management](../docs/OPERATIONS.md) — queue jobs and database state
- [Notification system](../docs/NOTIFICATIONS.md) — realtime event subscriptions

---

## Maintenance Notes

- **Update this guide** when adding new query hooks or changing cache invalidation patterns
- **Test cache behavior** in E2E tests by verifying queries refetch after mutations
- **Monitor stale times** — if users see stale data, reduce stale times or add manual refetch
- **Document new query keys** in the cache key factory to prevent collisions
