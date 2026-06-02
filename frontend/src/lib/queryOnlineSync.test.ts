import { describe, it, expect } from 'vitest'
import {
    isReconnectRefetchQueryKey,
    RECONNECT_REFETCH_ROOT_KEYS,
} from './queryOnlineSync'

describe('queryOnlineSync', () => {
    it('targets portfolio and price query roots for reconnect refetch', () => {
        expect(RECONNECT_REFETCH_ROOT_KEYS.has('portfolios')).toBe(true)
        expect(RECONNECT_REFETCH_ROOT_KEYS.has('prices')).toBe(true)
        expect(isReconnectRefetchQueryKey(['portfolios', 'list', 'GABC'])).toBe(true)
        expect(isReconnectRefetchQueryKey(['prices'])).toBe(true)
        expect(isReconnectRefetchQueryKey(['notifications', 'prefs'])).toBe(false)
    })
})
