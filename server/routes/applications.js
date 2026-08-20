const crudRouter = require('./_crud');
const { applicationCreate, applicationUpdate } = require('../schemas');

module.exports = crudRouter({
  table: 'applications',
  columns: ['company', 'role', 'stage', 'applied_on', 'url', 'notes', 'created_at'],
  createSchema: applicationCreate,
  updateSchema: applicationUpdate,
  orderBy: 'applied_on desc, id desc',
  notFound: 'application not found',
});
