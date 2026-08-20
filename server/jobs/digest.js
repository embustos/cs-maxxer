// Daily email digest: what's due today, what's coming up, what's slipping.
//
//   node jobs/digest.js            send to everyone who has anything to report
//   node jobs/digest.js --dry-run  print instead of sending (always try this first)
//
// Scheduling belongs OUTSIDE the app — a host's cron, or GitHub Actions `schedule`.
// A setInterval inside the web server fires once per running instance, so scaling to
// two servers silently doubles everyone's email.
const config = require('../config');
const db = require('../db');

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

async function send(to, body) {
  if (!config.resendApiKey) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'cs-tracker <onboarding@resend.dev>',
      to,
      subject: 'Your cs-tracker digest',
      text: body,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const today = new Date().toLocaleDateString('en-CA');
  const { rows: users } = await db.query('select id, email from users');

  for (const user of users) {
    const digest = await buildDigest(user.id, today);
    const body = render(digest);
    if (!body) continue; // nothing to say — don't send an empty email

    if (dryRun) {
      console.log(`\n──── to: ${user.email} ────\n${body}`);
    } else {
      // One user's bad address must not stop everyone else's mail.
      try {
        await send(user.email, body);
        console.log(`sent to ${user.email}`);
      } catch (err) {
        console.error(`failed for ${user.email}: ${err.message}`);
      }
    }
  }
  await db.end();
}

if (require.main === module) main();
module.exports = { buildDigest, render };
