// Turns a zod schema into middleware. On success req.body is the PARSED value —
// trimmed, coerced, defaults filled — so routes never touch raw input.
module.exports = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    return res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message });
  }
  req[source] = result.data;
  next();
};
