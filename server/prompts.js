// Prompts and their output schemas, kept apart from the transport in ai.js so they can be
// unit-tested without an API key or a network call.

// The schema IS the UI contract — MessageReview.jsx renders exactly these fields.
const messageReviewSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['send', 'revise'] },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'What genuinely works. Empty array if nothing does — do not invent praise.',
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: 'The exact span from the draft, verbatim.' },
          problem: { type: 'string', description: 'Why it weakens the message, in one sentence.' },
          fix: { type: 'string', description: 'The concrete change to make.' },
        },
        required: ['quote', 'problem', 'fix'],
        additionalProperties: false,
      },
    },
    rewrite: { type: 'string', description: 'One improved version of the whole message.' },
  },
  required: ['verdict', 'strengths', 'issues', 'rewrite'],
  additionalProperties: false,
};

const MESSAGE_SYSTEM = `You review cold outreach messages written by computer science students to people in industry — recruiters, engineers, alumni. Your job is to make the message more likely to get a reply.

What makes these messages fail, in order of how often it happens:
- No specific ask. "Pick your brain" or "connect" gives the reader nothing to say yes to. A good ask is small, concrete, and easy to decline.
- Nothing that proves the sender knows who they're writing to. A message that could be sent to a hundred people reads like it was.
- Length. Anything past a short paragraph competes with the reader's inbox and loses.
- Filler that appears in every cold message: "I'd love to learn about your journey", "I'm passionate about", "reaching out because I admire your work". These are invisible to the reader — cut them.
- Asking for a job outright. Asking for information, perspective, or 15 minutes works; asking for a referral from a stranger does not.

Judge the draft as the recipient would read it, in the five seconds they'll actually give it.

Quote spans exactly as written — the interface highlights your quotes in the original text, so a paraphrase will fail to match. Do not invent strengths to be encouraging; an empty strengths list is a legitimate answer. Keep the sender's voice in your rewrite: fix what's weak, don't replace them with a different person. Set verdict to "send" only if you'd send it as-is.`;

function buildMessageReview({ draft, channel, connection }) {
  const about = [
    connection?.name && `Name: ${connection.name}`,
    connection?.role && `Role: ${connection.role}`,
    connection?.company && `Company: ${connection.company}`,
    connection?.relationship && `Relationship to sender: ${connection.relationship}`,
    connection?.met_at && `How they're connected: ${connection.met_at}`,
    connection?.notes?.length && `Notes the sender kept:\n${connection.notes.map((n) => `- ${n}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    system: MESSAGE_SYSTEM,
    schema: messageReviewSchema,
    // Delimited so the draft can't be confused with the instructions around it. The model
    // has no tools here and takes no actions, so the worst case of anything odd inside
    // the draft is a bad review, not a bad action.
    user: `Recipient:
${about || '(the sender recorded nothing about them)'}

Channel: ${channel}

<draft>
${draft}
</draft>

Review this draft.`,
  };
}

const resumeReviewSchema = {
  type: 'object',
  properties: {
    overall: { type: 'string', description: 'Two sentences: the honest headline.' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Which part, e.g. "Experience", "Projects".' },
          working: { type: 'array', items: { type: 'string' } },
          fix: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string', description: 'The exact line, verbatim.' },
                rewrite: { type: 'string', description: 'That one line, rewritten.' },
                why: { type: 'string' },
              },
              required: ['quote', 'rewrite', 'why'],
              additionalProperties: false,
            },
          },
        },
        required: ['section', 'working', 'fix'],
        additionalProperties: false,
      },
    },
    missing: {
      type: 'array',
      items: { type: 'string' },
      description: 'Things a reader would expect that are absent.',
    },
  },
  required: ['overall', 'sections', 'missing'],
  additionalProperties: false,
};

const RESUME_SYSTEM = `You review resumes and LinkedIn profiles for computer science students applying to internships and new-grad roles. The reader you are writing for is a recruiter giving this six seconds, or an engineer skimming before an interview.

What actually costs students callbacks:
- Bullets that describe responsibilities instead of results. "Worked on the backend team" says nothing; "cut p95 latency 400ms→90ms by adding an index" says everything.
- No numbers. Scale, impact, or volume — any of them beat none.
- Passive, hedged verbs: "helped with", "assisted in", "was involved in".
- Listing a technology without evidence of having used it for anything.
- Projects with no link, or a link to an empty repository.
- Length past one page for a student, or dense blocks nobody will read.

Rewrite individual lines — never the whole document. The student has to be able to defend every line in an interview, so a rewrite that invents accomplishments is worse than useless. If a line lacks the numbers it needs, say what to go measure rather than inventing a figure. Quote lines exactly as written.`;

function buildResumeReview({ text, targetRole }) {
  return {
    system: RESUME_SYSTEM,
    schema: resumeReviewSchema,
    user: `${targetRole ? `Target role: ${targetRole}\n\n` : ''}<document>
${text}
</document>

Review this.`,
  };
}

module.exports = {
  buildMessageReview,
  buildResumeReview,
  messageReviewSchema,
  resumeReviewSchema,
};
