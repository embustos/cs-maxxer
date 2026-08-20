const crudRouter = require('./_crud');
const { goalCreate, goalUpdate } = require('../schemas');

module.exports = crudRouter({
  table: 'goals',
  columns: ['title', 'target', 'current', 'due_on'],
  createSchema: goalCreate,
  updateSchema: goalUpdate,
  orderBy: 'due_on asc nulls last, id',
  notFound: 'goal not found',
});
