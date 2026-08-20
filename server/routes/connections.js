const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const crudRouter = require('./_crud');
const { connectionCreate, connectionUpdate, noteCreate, outreachCreate, outreachUpdate } = require('../schemas');

const COLUMNS = ['name', 'company', 'role', 'relationship', 'linkedin_url', 'email',
  'met_at', 'last_contacted_on', 'follow_up_on', 'created_at'];

// The list/create/patch/delete half is the same shape as applications, events, and goals —
// so it comes from the same factory rather than a sixth hand-written copy.
const router = crudRouter({
  table: 'connections',
  columns: COLUMNS,
  createSchema: connectionCreate,
  updateSchema: connectionUpdate,
  orderBy: 'follow_up_on asc nulls last, name',
  notFound: 'connection not found',
});

const asId = (v) => (/^\d+$/.test(v) ? Number(v) : null);

// Every child route re-checks ownership of the PARENT. Without this, knowing a connection
// id would be enough to read someone else's notes — the child rows carry user_id too, but
// checking the parent is what makes "not yours" indistinguishable from "doesn't exist".
async function ownedConnection(req, res) {
  const id = asId(req.params.id);
  if (id === null) return null;
  const { rows } = await db.query(
    'select id, name, company, role, relationship, met_at from connections where id = $1 and user_id = $2',
    [id, req.user.id],
  );
  return rows[0] ?? null;
}

const child = express.Router({ mergeParams: true });
child.use(requireAuth);

child.get('/', async (req, res) => {
  const connection = await ownedConnection(req, res);
  if (!connection) return res.status(404).json({ error: 'connection not found' });

  const [notes, messages] = await Promise.all([
    db.query('select id, body, created_at from connection_notes where connection_id = $1 order by created_at desc', [connection.id]),
    db.query(
      `select id, channel, draft, review_json, reviewed_at, sent_at, created_at
         from outreach_messages where connection_id = $1 order by created_at desc`,
      [connection.id],
    ),
  ]);
  res.json({ connection, notes: notes.rows, messages: messages.rows });
});

child.post('/notes', validate(noteCreate), async (req, res) => {
  const connection = await ownedConnection(req, res);
  if (!connection) return res.status(404).json({ error: 'connection not found' });

  const { rows } = await db.query(
    'insert into connection_notes (connection_id, user_id, body) values ($1, $2, $3) returning id, body, created_at',
    [connection.id, req.user.id, req.body.body],
  );
  res.status(201).json({ note: rows[0] });
});

child.delete('/notes/:noteId', async (req, res) => {
  const noteId = asId(req.params.noteId);
  if (noteId === null) return res.status(404).json({ error: 'note not found' });
  const { rowCount } = await db.query(
    'delete from connection_notes where id = $1 and user_id = $2',
    [noteId, req.user.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'note not found' });
  res.status(204).end();
});

child.post('/messages', validate(outreachCreate), async (req, res) => {
  const connection = await ownedConnection(req, res);
  if (!connection) return res.status(404).json({ error: 'connection not found' });

  const { rows } = await db.query(
    `insert into outreach_messages (connection_id, user_id, channel, draft)
     values ($1, $2, $3, $4)
     returning id, channel, draft, review_json, reviewed_at, sent_at, created_at`,
    [connection.id, req.user.id, req.body.channel, req.body.draft],
  );
  res.status(201).json({ message: rows[0] });
});

child.patch('/messages/:messageId', validate(outreachUpdate), async (req, res) => {
  const messageId = asId(req.params.messageId);
  if (messageId === null) return res.status(404).json({ error: 'message not found' });

  const sets = ['updated_at = now()'];
  const values = [];
  if (req.body.draft !== undefined) {
    sets.push(`draft = $${values.push(req.body.draft)}`);
    // Editing the draft invalidates the cached review — it reviewed different text.
    sets.push('review_json = null', 'reviewed_at = null');
  }
  if (req.body.channel !== undefined) sets.push(`channel = $${values.push(req.body.channel)}`);
  if (req.body.sent !== undefined) sets.push(`sent_at = ${req.body.sent ? 'now()' : 'null'}`);

  const { rows } = await db.query(
    `update outreach_messages set ${sets.join(', ')}
      where id = $${values.push(messageId)} and user_id = $${values.push(req.user.id)}
      returning id, channel, draft, review_json, reviewed_at, sent_at, created_at`,
    values,
  );
  if (!rows[0]) return res.status(404).json({ error: 'message not found' });

  // Marking a message sent is also the moment we learned they were contacted.
  if (req.body.sent) {
    await db.query(
      `update connections set last_contacted_on = current_date
        where id = (select connection_id from outreach_messages where id = $1) and user_id = $2`,
      [messageId, req.user.id],
    );
  }
  res.json({ message: rows[0] });
});

child.delete('/messages/:messageId', async (req, res) => {
  const messageId = asId(req.params.messageId);
  if (messageId === null) return res.status(404).json({ error: 'message not found' });
  const { rowCount } = await db.query(
    'delete from outreach_messages where id = $1 and user_id = $2',
    [messageId, req.user.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'message not found' });
  res.status(204).end();
});

router.use('/:id', child);

module.exports = router;
