import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// The `cn` helper every shadcn component imports: clsx resolves conditionals, twMerge
// dedupes conflicting Tailwind classes so a later `px-4` actually beats an earlier `px-2`.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A thrown value is `unknown` — JS let `err.message` through even when the throw was a
// string, a rejected non-Error, or undefined, which turns one failure into two.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// "updated 3 minutes ago" without a date library. Intl.RelativeTimeFormat is stdlib and
// handles the pluralisation and the wording; all we pick is which unit to hand it.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso?: string): string {
  const secs = (Date.now() - Date.parse(iso ?? '')) / 1000
  if (!Number.isFinite(secs)) return ''
  for (const [unit, size] of UNITS) {
    if (secs >= size) return rtf.format(-Math.floor(secs / size), unit)
  }
  return 'just now'
}
