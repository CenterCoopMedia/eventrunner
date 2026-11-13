'use strict';

/**
 * speaker.discussion_points: an inline notice to the event support address
 * after a speaker saves private discussion points. The submitted text uses a
 * normal token, so the HTML renderer escapes it. The audit stores no rendered
 * subject or body because they contain the private submission.
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">{{speaker_name}} submitted discussion points.</p>',
    '<p style="margin:0 0 8px 0;"><strong>Submission revision:</strong> {{submission_revision}}<br><strong>Submitted:</strong> {{submitted_at}}</p>',
    '<p style="margin:0 0 8px 0;"><strong>Discussion points:</strong></p>',
    '<p style="margin:0;white-space:pre-wrap;">{{discussion_points}}</p>',
  ].join('\n'),
);

const text = [
  '{{speaker_name}} submitted discussion points.',
  '',
  'Submission revision: {{submission_revision}}',
  'Submitted: {{submitted_at}}',
  '',
  'Discussion points:',
  '{{discussion_points}}',
  '',
  TEXT_FOOTER,
].join('\n');

module.exports = {
  id: 'speaker.discussion_points',
  subject: 'Discussion points from {{speaker_name}} for {{event_name}}',
  html,
  text,
  tokens: [
    ...GLOBAL_TOKEN_NAMES,
    'speaker_name',
    'discussion_points',
    'submission_revision',
    'submitted_at',
  ],
  requiredTokens: ['speaker_name', 'discussion_points', 'submission_revision', 'submitted_at'],
  storeRendered: false,
  redactAuditErrors: true,
};
