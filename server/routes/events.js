const crudRouter = require('./_crud');
const { eventCreate, eventUpdate } = require('../schemas');
const { z } = require('zod');

// attended is set by the UI checkbox but never supplied at creation time.
module.exports = crudRouter({
  table: 'events',
  columns: ['title', 'kind', 'kind_label', 'starts_at', 'ends_at', 'location', 'url', 'attended'],
  createSchema: eventCreate,
  updateSchema: eventUpdate.extend({ attended: z.boolean().optional() }),
  orderBy: 'starts_at asc',
  notFound: 'event not found',
});
