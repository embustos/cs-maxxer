import type { ApplicationStage } from '@/types'

// The stage list and its labels live here rather than in Applications.tsx, because the
// detail dialog needs them too and importing them from the page that renders the dialog
// would be a cycle.
export const STAGES = ['applied', 'oa', 'interview', 'offer', 'rejected', 'ghosted'] as const

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied', oa: 'OA', interview: 'Interview',
  offer: 'Offer', rejected: 'Rejected', ghosted: 'Ghosted',
}

export const isStage = (v: string): v is ApplicationStage =>
  (STAGES as readonly string[]).includes(v)
