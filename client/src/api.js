const API = import.meta.env.VITE_API ?? 'http://localhost:3000/api';

export const getToken = () => localStorage.getItem('token');
export const setToken = (t) => localStorage.setItem('token', t);
export const clearToken = () => localStorage.removeItem('token');

// Single choke point: every request to the server goes through here, so the
// Authorization header is attached in exactly one place.
export async function api(path, { body, ...options } = {}) {
  const token = getToken();
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  const data = await res.json().catch(() => ({}));
  // 401 = expired or tampered. Drop the dead token so we don't keep resending it.
  if (res.status === 401) clearToken();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
