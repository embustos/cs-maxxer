const API = (import.meta.env.VITE_API as string | undefined) ?? 'http://localhost:3000/api'

export const getToken = () => localStorage.getItem('token')
export const setToken = (t: string) => localStorage.setItem('token', t)
export const clearToken = () => localStorage.removeItem('token')

interface ApiOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown
  // Narrowed from HeadersInit: the spread below is only valid for a plain object, and
  // HeadersInit also permits a Headers instance or an array of pairs.
  headers?: Record<string, string>
}

// Single choke point: every request to the server goes through here, so the
// Authorization header is attached in exactly one place.
export async function api<T = unknown>(path: string, { body, ...options }: ApiOptions = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  }
  if (token) headers.authorization = `Bearer ${token}`

  const res = await fetch(API + path, {
    ...options,
    headers,
    // `body` is unknown, so the old `...(body && {...})` spread wasn't guaranteed to be
    // an object. An explicit undefined is both correct and what fetch expects.
    body: body === undefined || body === null ? undefined : JSON.stringify(body),
  })

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  // 401 = expired or tampered. Drop the dead token so we don't keep resending it.
  if (res.status === 401) clearToken()
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data as T
}
