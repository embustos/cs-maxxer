// applications, events and goals are the same six routes over different columns.
// Writing them three times would be three places to forget `user_id`.
//
// Column names come from THIS file, never from user input — they cannot be
// parameterized, so they must never be attacker-controlled. Values always go through $1.
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const asId = (v) => (/^\d+$/.test(v) ? Number(v) : null);

module.exports = function crudRouter({ table, columns, createSchema, updateSchema, orderBy, notFound }) {
  const router = express.Router();
  router.use(requireAuth);
  const cols = ['id', ...columns].join(', ');

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `select ${cols} from ${table} where user_id = $1 order by ${orderBy}`,
      [req.user.id],
    );
    res.json({ [table]: rows });
  });

  router.post('/', validate(createSchema), async (req, res) => {
    const keys = columns.filter((c) => req.body[c] !== undefined);
    const values = keys.map((k) => req.body[k]);
    const placeholders = keys.map((_, i) => `$${i + 2}`);
    const { rows } = await db.query(
      `insert into ${table} (user_id, ${keys.join(', ')})
       values ($1, ${placeholders.join(', ')}) returning ${cols}`,
      [req.user.id, ...values],
    );
    res.status(201).location(`${req.baseUrl}/${rows[0].id}`).json({ [table.slice(0, -1)]: rows[0] });
  });

  router.patch('/:id', validate(updateSchema), async (req, res) => {
    const id = asId(req.params.id);
    if (id === null) return res.status(404).json({ error: notFound });

    const keys = columns.filter((c) => req.body[c] !== undefined);
    if (!keys.length) return res.status(400).json({ error: 'nothing to update' });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map((k) => req.body[k]);
    const { rows } = await db.query(
      `update ${table} set ${sets.join(', ')}
        where id = $${values.length + 1} and user_id = $${values.length + 2}
        returning ${cols}`,
      [...values, id, req.user.id],
    );
    // Not yours and doesn't exist answer identically — a 403 would confirm it exists.
    if (!rows[0]) return res.status(404).json({ error: notFound });
    res.json({ [table.slice(0, -1)]: rows[0] });
  });

  router.delete('/:id', async (req, res) => {
    const id = asId(req.params.id);
    if (id === null) return res.status(404).json({ error: notFound });
    const { rowCount } = await db.query(`delete from ${table} where id = $1 and user_id = $2`, [
      id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: notFound });
    res.status(204).end();
  });

  return router;
};
