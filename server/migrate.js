// ponytail: ~25 lines instead of Knex/Prisma. Numbered .sql files, applied once, in
// order, recorded in a table. That is the whole idea behind every migration tool.
//   run with: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DIR = path.join(__dirname, 'migrations');

async function migrate() {
  await db.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);

  const { rows } = await db.query('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    // Each migration is one transaction: it fully applies or not at all. Without this
    // a migration that fails halfway leaves the schema in a state nobody can reason about.
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
      ran++;
    } catch (err) {
      await client.query('rollback');
      throw new Error(`migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  console.log(ran ? `${ran} migration(s) applied` : 'already up to date');
}

migrate()
  .then(() => db.end())
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
