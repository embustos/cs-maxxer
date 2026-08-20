// The shapes the API actually returns. These mirror the columns each route selects —
// if a route stops returning a field, tsc points at every place that read it.

export interface User {
  id: number
  email: string
  github_username: string | null
  daily_commit_goal: number | null
  onboarded_at: string | null
  reminder_cadence: 'daily' | 'weekly' | 'off' | null
}

export interface Habit {
  id: number
  title: string
  cadence: 'daily' | 'weekly'
  target_per_week: number
  created_at: string
  done_today: boolean
  streak: number
  last_7_days: number
}

export type ApplicationStage = 'applied' | 'oa' | 'interview' | 'offer' | 'rejected' | 'ghosted'

export interface Application {
  id: number
  company: string
  role: string
  stage: ApplicationStage
  applied_on: string
  url: string | null
  notes: string | null
  created_at: string
}

export type EventKind = 'club' | 'career_fair' | 'conference' | 'networking' | 'deadline' | 'other'

export interface CalendarEvent {
  id: number
  title: string
  kind: EventKind
  starts_at: string
  location: string | null
  url: string | null
  attended: boolean
}

export interface Goal {
  id: number
  title: string
  target: number
  current: number
  due_on: string | null
}

export type Relationship = 'recruiter' | 'engineer' | 'alum' | 'professor' | 'peer' | 'manager' | 'other'

export interface Connection {
  id: number
  name: string
  company: string | null
  role: string | null
  relationship: Relationship
  linkedin_url: string | null
  email: string | null
  met_at: string | null
  last_contacted_on: string | null
  follow_up_on: string | null
  created_at: string
}

export interface ConnectionNote {
  id: number
  body: string
  created_at: string
}

export interface OutreachMessage {
  id: number
  channel: 'linkedin' | 'email' | 'other'
  draft: string
  review_json: MessageReviewResult | null
  reviewed_at: string | null
  sent_at: string | null
  created_at: string
}

export interface InterviewAnswer {
  id: number
  question: string
  application_id: number | null
  situation: string | null
  task: string | null
  action: string | null
  result: string | null
  updated_at: string
}

// Mirrors the JSON Schema in server/prompts.js. The schema is the contract; this is the
// same contract on the client side, so a change to one should fail the other.
export interface ReviewIssue {
  quote: string
  problem: string
  fix: string
}

export interface MessageReviewResult {
  verdict: 'send' | 'revise'
  strengths: string[]
  issues: ReviewIssue[]
  rewrite: string
}

export interface ResumeSection {
  section: string
  working: string[]
  fix: { quote: string; rewrite: string; why: string }[]
}

export interface ResumeReviewResult {
  overall: string
  sections: ResumeSection[]
  missing: string[]
}

export interface GitHubActivity {
  connected: boolean
  username?: string
  days?: Record<string, number>
  total?: number
  days_active?: number
  last_commit_on?: string | null
  source?: 'graphql' | 'events'
  cached?: boolean
  stale?: boolean
  error?: string
  today_count?: number
  daily_commit_goal: number | null
}

export interface WeeklyMetric {
  label: string
  value: number
  previous: number
  delta: number
}

export interface WeeklyReviewData {
  week_start: string
  week_end: string
  metrics: WeeklyMetric[]
}

export interface Toast {
  message: string
  onUndo: (() => void) | null
}

// Every resource card takes the same shape from the dashboard, so it's declared once.
export interface CardProps<T> {
  items: T[]
  loading: boolean
  reload: () => void
  onError: (message: string) => void
  onToast: (message: string, onUndo?: (() => void) | null) => void
  onDelete: (item: T) => void
}
