'use strict';

/**
 * speaker.accepted — the confirmation a speaker gets the moment their
 * invitation is accepted and their account is linked (spec §6.2, phase 3;
 * issue #21).
 *
 * Sent by `acceptSpeakerInvite` with `onceKey: speaker-accepted:{speakerId}`
 * — the exact key §3.1's send-once table assigns this template, which is
 * what makes the mail arrive once per speaker even though the acceptance
 * handler is safely retriable (see functions/src/speakers/invites.cjs).
 *
 * requiredTokens: ['profile_wizard_url'] — same reasoning as
 * account.welcome's ['login_url'] (§6.1): this mail's whole job is getting
 * the speaker to the profile they now need to complete, and an override that
 * drops the link leaves them with a congratulation and nowhere to go.
 *
 * {{deadline}} is declared but deliberately NOT referenced in the shipped
 * copy: no config field states a speaker-profile deadline, and shipped
 * default copy must not assert a date the deployment never set. A client
 * with one adds it through an `email_templates/speaker.accepted` override;
 * the handler passes the event's first day as the value, so the token
 * renders rather than warning when they do.
 *
 * storeRendered: true — unlike speaker.invite this body carries no bearer
 * credential, so the ordinary `sent_emails` audit applies.
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

// COPY NOTE (issue #21 → #22): {{profile_wizard_url}} currently resolves to
// /profile, which edits the ATTENDEE record (users/{uid}) — not the
// canonical `speakers/{id}` document an organizer approves. So the copy
// below promises exactly that and no more: the account details, plus "an
// organizer will be in touch about your speaker details". Issue #22 ships
// the speaker profile wizard; when it lands, this body gains the "write your
// speaker bio" instruction and the caller
// (functions/src/speakers/invites.cjs) points the token at the wizard route.
// Promising the wizard now would send every accepted speaker to a page that
// cannot do what the mail said.
const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{speaker_name}},</p>',
    '<p style="margin:0 0 16px 0;">Thank you — your place at {{event_name}} is confirmed, and this invitation is now linked to your account.</p>',
    '<p style="margin:0 0 16px 0;">An organizer will be in touch about your session and the biography and photograph we publish on the programme.</p>',
    '<p style="margin:0 0 16px 0;">In the meantime you can check your account details — your name, pronouns, and how you appear to other attendees:</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{profile_wizard_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Check your account details</a>',
    '</p>',
    '<p style="margin:0;">Your speaker profile appears publicly once an organizer has reviewed it.</p>',
  ].join('\n')
);

const text = [
  'Hi {{speaker_name}},',
  '',
  'Thank you — your place at {{event_name}} is confirmed, and this invitation is now linked to your account.',
  '',
  'An organizer will be in touch about your session and the biography and photograph we publish on the programme.',
  '',
  'In the meantime you can check your account details — your name, pronouns, and how you appear to other attendees:',
  '{{profile_wizard_url}}',
  '',
  'Your speaker profile appears publicly once an organizer has reviewed it.',
  '',
  '--',
  '{{postal_address_html}}',
].join('\n');

module.exports = {
  id: 'speaker.accepted',
  subject: 'You are confirmed for {{event_name}}',
  html,
  text,
  tokens: [...GLOBAL_TOKEN_NAMES, 'speaker_name', 'profile_wizard_url', 'deadline'],
  requiredTokens: ['profile_wizard_url'],
  storeRendered: true,
};
