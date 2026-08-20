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

const credentials = z.object({
  // Order matters: trim/lowercase FIRST, then validate. Validating first would reject
  // " Me@School.edu " over whitespace the user never meant to type.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8, 'password must be at least 8 characters').max(200),
});

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

module.exports = {
  credentials,
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
};
