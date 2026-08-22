// Every shape the API accepts, declared once. Routes stop hand-rolling if-checks and
// error messages become consistent for free.
//
// This is a TRUST BOUNDARY: everything arriving here came from someone else's machine
// and is a lie until proven otherwise. The client's own checks are for UX only.
const { z } = require('zod');

const trimmed = (max) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like YYYY-MM-DD');
const optionalUrl = z.union([z.url(), z.literal(''), z.null()]).optional();

// Create and update are built from ONE field list per entity.
//   create → defaults applied, required fields required
//   update → every field optional, NO defaults
// That last part matters: if PATCH filled defaults, sending {title} alone would
// silently reset cadence to 'daily'. Defaults belong to creation, not to editing.
const entity = (fields, defaults = {}) => ({
  create: z.object(fields).extend(
    Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, fields[k].default(v)])),
  ),
  update: z.object(fields).partial(),
});

const connection = entity(
  {
    name: trimmed(120),
    company: z.string().max(120).nullish(),
    role: z.string().max(120).nullish(),
    relationship: z.enum(['recruiter', 'engineer', 'alum', 'professor', 'peer', 'manager', 'other']),
    linkedin_url: optionalUrl,
    email: z.union([z.email(), z.literal(''), z.null()]).optional(),
    met_at: z.string().max(200).nullish(),
    last_contacted_on: isoDate.nullish(),
    follow_up_on: isoDate.nullish(),
  },
  { relationship: 'other' },
);

// Display identity. Reserved-ish characters are excluded so a username can safely become
// a URL segment (/u/emiliano) on a future profile or leaderboard page without escaping.
const username = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,20}$/, 'username must be 3-20 letters, numbers, or underscores');

const credentials = z.object({
  // Order matters: trim/lowercase FIRST, then validate. Validating first would reject
  // " Me@School.edu " over whitespace the user never meant to type.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8, 'password must be at least 8 characters').max(200),
});

const registration = credentials.extend({ username });

const habit = entity(
  {
    title: trimmed(120),
    cadence: z.enum(['daily', 'weekly']),
    target_per_week: z.coerce.number().int().min(1).max(7),
  },
  { cadence: 'daily', target_per_week: 7 },
);

const application = entity(
  {
    company: trimmed(120),
    role: trimmed(120),
    stage: z.enum(['applied', 'oa', 'interview', 'offer', 'rejected', 'ghosted']),
    applied_on: isoDate,
    url: optionalUrl,
    notes: z.string().max(2000).nullish(),
  },
  { stage: 'applied' },
);

const event = entity(
  {
    title: trimmed(160),
    kind: z.enum(['club', 'career_fair', 'conference', 'networking', 'deadline', 'other']),
    starts_at: z.iso.datetime({ offset: true }).or(z.iso.datetime()),
    location: z.string().max(160).nullish(),
    url: optionalUrl,
  },
  { kind: 'other' },
);

const goal = entity(
  {
    title: trimmed(160),
    target: z.coerce.number().int().min(1).max(100000),
    current: z.coerce.number().int().min(0).max(100000),
    due_on: isoDate.nullish(),
  },
  { current: 0 },
);

// Every STAR part is optional on its own — a half-written answer is worth saving, and
// the UI shows you which parts are still blank rather than blocking the save.
const interviewAnswer = z.object({
  question: trimmed(500),
  application_id: z.coerce.number().int().positive().nullish(),
  situation: z.string().max(3000).nullish(),
  task: z.string().max(3000).nullish(),
  action: z.string().max(3000).nullish(),
  result: z.string().max(3000).nullish(),
});

// The survey submits everything at once so it can be written in a single transaction.
// Caps exist because this is an unauthenticated-ish first action — a new account
// shouldn't be able to seed 10,000 rows.
const onboarding = z.object({
  habits: z.array(trimmed(120)).max(12).default([]),
  goals: z
    .array(
      z.object({
        title: trimmed(160),
        target: z.coerce.number().int().min(1).max(100000),
        due_on: isoDate.nullish(),
      }),
    )
    .max(8)
    .default([]),
  reminder_cadence: z.enum(['daily', 'weekly', 'off']).default('weekly'),
  github_username: z.string().trim().regex(/^[a-zA-Z0-9-]{1,39}$/).nullish(),
});

// Drafts and resumes are the largest bodies the API accepts. The caps are what makes a
// per-review cost predictable — an unbounded body is an unbounded bill.
const messageReview = z.object({
  draft: z.string().trim().min(20, 'write a bit more before reviewing').max(4000),
  channel: z.enum(['linkedin', 'email', 'other']).default('linkedin'),
  connection_id: z.coerce.number().int().positive().nullish(),
});

const resumeReview = z.object({
  text: z.string().trim().min(100, 'paste more of the document').max(20000),
  target_role: z.string().trim().max(120).nullish(),
});

module.exports = {
  credentials,
  registration,
  // Reset is a password change without a current password, so the token IS the proof.
  // Reusing credentials' own fields rather than redeclaring them: a reset flow that
  // accepts a weaker password than signup is a way to downgrade an account, and two
  // copies of the rule is how that happens.
  forgotPassword: z.object({ email: credentials.shape.email }),
  resetPassword: z.object({
    token: z.string().min(1),
    password: credentials.shape.password,
  }),
  emailToken: z.object({ token: z.string().min(1) }),
  connectionCreate: connection.create,
  connectionUpdate: connection.update,
  noteCreate: z.object({ body: z.string().trim().min(1).max(4000) }),
  outreachCreate: z.object({
    draft: z.string().trim().min(1).max(4000),
    channel: z.enum(['linkedin', 'email', 'other']).default('linkedin'),
  }),
  outreachUpdate: z.object({
    draft: z.string().trim().min(1).max(4000).optional(),
    channel: z.enum(['linkedin', 'email', 'other']).optional(),
    sent: z.boolean().optional(),
  }),
  messageReview,
  resumeReview,
  onboarding,
  interviewCreate: interviewAnswer,
  interviewUpdate: interviewAnswer.partial(),
  habitCreate: habit.create,
  habitUpdate: habit.update,
  applicationCreate: application.create.partial({ applied_on: true }),
  applicationUpdate: application.update,
  eventCreate: event.create,
  eventUpdate: event.update,
  goalCreate: goal.create,
  goalUpdate: goal.update,
  isoDate,
  githubUsername: z.string().trim().regex(/^[a-zA-Z0-9-]{1,39}$/, 'not a valid GitHub username'),
  // Matches the CHECK constraint in migration 006 — validation and schema agree, so a
  // bad value is a readable 400 rather than a Postgres constraint violation surfacing
  // as a 500.
  dailyCommitGoal: z.coerce.number().int().min(1).max(50),
};
