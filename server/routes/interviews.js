const crudRouter = require('./_crud');
const { interviewCreate, interviewUpdate } = require('../schemas');

// Same owned-resource shape as everything else, so it comes from the same factory.
module.exports = crudRouter({
  table: 'interview_answers',
  columns: ['question', 'application_id', 'situation', 'task', 'action', 'result', 'updated_at'],
  createSchema: interviewCreate,
  updateSchema: interviewUpdate,
  orderBy: 'updated_at desc',
  notFound: 'answer not found',
});
