// Daily email digest: what's due today, what's coming up, what's slipping.
//
//   node jobs/digest.js            send to everyone who has anything to report
//   node jobs/digest.js --dry-run  print instead of sending (always try this first)
//   node jobs/digest.js --force --only me@x.com   one recipient, ignoring cadence
//
// Scheduling belongs OUTSIDE the app — a host's cron, or GitHub Actions `schedule`.
// A setInterval inside the web server fires once per running instance, so scaling to
// two servers silently doubles everyone's email.
const db = require('../db');
const mail = require('../email');

async function buildDigest(userId, today) {
  const [habits, events, apps] = await Promise.all([
    db.query(
      `select h.title from habits h
        where h.user_id = $1 and h.archived_at is null
          and not exists (select 1 from habit_completions c
                           where c.habit_id = h.id and c.completed_on = $2::date)
        order by h.created_at`,
      [userId, today],
    ),
    db.query(
      `select title, starts_at from events
        where user_id = $1 and starts_at between $2::date and $2::date + 7
        order by starts_at`,
      [userId, today],
    ),
    db.query(
      `select company, role, applied_on from applications
        where user_id = $1 and stage = 'applied' and applied_on < $2::date - 14
        order by applied_on`,
      [userId, today],
    ),
  ]);

  return { pending: habits.rows, upcoming: events.rows, stale: apps.rows };
}

const render = ({ pending, upcoming, stale }) => {
  const lines = [];
  // Lead with the single most useful instruction, then the detail.
  if (pending.length) lines.push(`Start here: ${pending[0].title}.`);
  else if (stale.length) lines.push(`Start here: follow up with ${stale[0].company}.`);
  else if (upcoming.length) lines.push(`Coming up: ${upcoming[0].title}.`);
  if (pending.length) lines.push(`Not done today:\n${pending.map((h) => `  · ${h.title}`).join('\n')}`);
  if (upcoming.length) {
    lines.push(
      `Coming up:\n${upcoming
        .map((e) => `  · ${e.title} — ${new Date(e.starts_at).toDateString()}`)
        .join('\n')}`,
    );
  }
  if (stale.length) {
    lines.push(
      `No word in 2+ weeks:\n${stale.map((a) => `  · ${a.company} — ${a.role}`).join('\n')}`,
    );
  }
  return lines.join('\n\n');
};

// Who should hear from us today. The onboarding survey already asks — ignoring that
// answer is the fastest way to get marked as spam, and it breaks a promise we made
// during signup.
//   daily  -> every day
//   weekly -> Mondays only
//   off    -> never, and they are excluded in SQL rather than filtered later
function shouldSendToday(cadence, date) {
  if (cadence === 'off') return false;
  if (cadence === 'weekly') return date.getDay() === 1; // Monday
  return true; // 'daily', and null for accounts that predate the survey
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force'); // ignore cadence, for testing only
  // Free-tier Resend only delivers to the account's own verified address, so a test run
  // that mails every row is mostly bounces. Narrow it to one recipient.
  const only = process.argv[process.argv.indexOf('--only') + 1];
  const now = new Date();
  const today = now.toLocaleDateString('en-CA');

  // email_verified_at is the anti-spam gate. Signups are open, so anyone can register
  // with a stranger's address — but nobody can click a link in an inbox they don't read,
  // so an unverified address never receives anything.
  const { rows: users } = await db.query(
    `select id, email, reminder_cadence from users
      where reminder_cadence is distinct from 'off' and email_verified_at is not null`,
  );

  let skipped = 0;
  for (const user of users) {
    if (only && user.email !== only) continue;
    if (!force && !shouldSendToday(user.reminder_cadence, now)) {
      skipped++;
      continue;
    }

    const digest = await buildDigest(user.id, today);
    const body = render(digest);
    if (!body) continue; // nothing to say — don't send an empty email

    if (dryRun) {
      console.log(`\n──── to: ${user.email} ────\n${body}`);
    } else {
      // One user's bad address must not stop everyone else's mail.
      try {
        await mail.send({ to: user.email, subject: 'Your cs maxxer digest', text: body });
        console.log(`sent to ${user.email}`);
      } catch (err) {
        console.error(`failed for ${user.email}: ${err.message}`);
      }
    }
  }
  if (skipped) console.log(`skipped ${skipped} (cadence not due today)`);
  await db.end();
}

if (require.main === module) main();
module.exports = { buildDigest, render, shouldSendToday };
