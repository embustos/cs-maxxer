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
