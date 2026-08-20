const { Pool } = require('pg');
const config = require('./config');

// A POOL, not a single connection: opening a TCP connection + auth per query would
// dominate the cost of a fast query. The pool keeps a handful open and hands them out.
module.exports = new Pool({ connectionString: config.databaseUrl });
