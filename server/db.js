const { Pool, types } = require('pg');
const config = require('./config');

// Hand DATE columns back as the 'YYYY-MM-DD' string Postgres actually stores.
//
// By default pg parses oid 1082 into a JS Date, which invents a time and a timezone that
// the column does not have. `due_on = 2026-10-21` became "2026-10-21T07:00:00.000Z" over
// JSON, and the client — which correctly expects a plain date — produced "by Invalid
// Date" on every goal, and a silent NaN in the follow-up-overdue filter.
//
// The invented timezone is the worse half: parsed as local midnight, a user east of UTC
// renders the previous day. A date has no time. Don't give it one.
//
// Here rather than in each route because every date column has this problem, and a fix
// per route is a fix you forget on the next one. TIMESTAMPTZ (1184) is untouched — that
// one really is an instant, and the client wants the full ISO string.
types.setTypeParser(types.builtins.DATE, (v) => v);

// A POOL, not a single connection: opening a TCP connection + auth per query would
// dominate the cost of a fast query. The pool keeps a handful open and hands them out.
module.exports = new Pool({ connectionString: config.databaseUrl });
