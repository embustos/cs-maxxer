import { useState, useCallback } from 'react'
import { api } from './api'

interface ReviewResponse<T> {
  review: T
  cached?: boolean
}

// Shared by the message and resume reviewers: runs a review, tracks loading, and keeps
// "not configured" separate from a real error so the UI can respond differently.
export function useReview<T>(endpoint: string) {
  const [review, setReview] = useState<T | null>(null)
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [error, setError] = useState('')

  const run = useCallback(
    async (body?: unknown, path: string = endpoint): Promise<T | null> => {
      setLoading(true)
      setError('')
      setUnavailable(null)
      try {
        const res = await api<ReviewResponse<T>>(path, { method: 'POST', body })
        setReview(res.review)
        setCached(Boolean(res.cached))
        return res.review
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // 503 means "not set up" — a different thing from "it broke", and it gets
        // different UI. See docs/09-error-handling.md.
        if (/ANTHROPIC_API_KEY/.test(message)) setUnavailable(message)
        else setError(message)
        return null
      } finally {
        setLoading(false)
      }
    },
    [endpoint],
  )

  return { review, cached, loading, unavailable, error, run, setReview, clear: () => setReview(null) }
}
