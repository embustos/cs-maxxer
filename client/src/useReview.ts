import { useState, useCallback } from 'react'
import { api, ApiError } from './api'

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
  // The quota's 429 sets upgrade:true when checkout is configured — out of free reviews
  // is a dead end only if we don't show the door.
  const [upgrade, setUpgrade] = useState(false)

  const run = useCallback(
    async (body?: unknown, path: string = endpoint): Promise<T | null> => {
      setLoading(true)
      setError('')
      setUnavailable(null)
      setUpgrade(false)
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
        if (err instanceof ApiError && err.data.upgrade) setUpgrade(true)
        return null
      } finally {
        setLoading(false)
      }
    },
    [endpoint],
  )

  // Stripe hosts the payment page; we just fetch its URL and go. The redirect leaves
  // the app entirely — Checkout brings the user back to /?purchase=success.
  const buy = useCallback(async () => {
    const { url } = await api<{ url: string }>('/billing/checkout', { method: 'POST' })
    window.location.assign(url)
  }, [])

  return { review, cached, loading, unavailable, error, upgrade, buy, run, setReview, clear: () => setReview(null) }
}
