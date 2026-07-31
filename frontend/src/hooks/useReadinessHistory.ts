import { useCallback, useEffect, useState } from 'react'
import { API_CONFIG } from '../config/api'

export interface ReadinessHistoryEntry {
  status: 'ready' | 'not_ready'
  timestamp: string
  summary: string
}

interface ReadinessHistoryResponse {
  entries: ReadinessHistoryEntry[]
}

async function fetchReadinessHistory(signal: AbortSignal): Promise<ReadinessHistoryEntry[]> {
  const base = API_CONFIG.BASE_URL.replace(/\/$/, '')
  const url = `${base}${API_CONFIG.ENDPOINTS.READINESS_HISTORY}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
    mode: 'cors',
    credentials: 'omit',
  })
  const ct = response.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    return []
  }
  const body: ReadinessHistoryResponse = await response.json()
  return body.entries ?? []
}

export function useReadinessHistory() {
  const [history, setHistory] = useState<ReadinessHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError(false)
    try {
      const entries = await fetchReadinessHistory(signal)
      setHistory(entries)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(true)
      setHistory([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { history, loading, error }
}
