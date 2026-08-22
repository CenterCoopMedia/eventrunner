'use strict';

/**
 * feedback.confirmation — sent to the submitter of a public feedback/bug
 * report when they gave an email address (spec §9 "Feedback inbox", issue
 * #28). No submitted-message token: the confirmation is a plain
 * acknowledgement, not a copy of arbitrary attendee-authored text, so there
 * is nothing here for a template override to leak or mis-render.
 *
 * requiredTokens: [] — unlike auth.otp, there is no single token this mail's
 * entire purpose hinges on, so no override check can fail it into an
 * unusable state the way a codeless OTP mail would be.
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi there,</p>',
    '<p style="margin:0 0 16px 0;">Thanks for your note about {{event_name}} — we received it and the team will follow up if it needs a reply.</p>',
    '<p style="margin:0;">If you have anything to add, just reply to this email.</p>',
  ].join('\n'),
);

const text = [
  'Hi there,',
  '',
  'Thanks for your note about {{event_name}} — we received it and the team will follow up if it needs a reply.',
  '',
  'If you have anything to add, just reply to this email.',
  '',
  '--',
  '{{postal_address_html}}',
].join('\n');

module.exports = {
  id: 'feedback.confirmation',
  subject: 'We received your feedback — {{event_name}}',
  html,
  text,
  tokens: GLOBAL_TOKEN_NAMES,
  requiredTokens: [],
  storeRendered: true,
};
