'use strict';

/**
 * speaker.accepted — the confirmation a speaker gets the moment their
 * invitation is accepted and their account is linked (spec §6.2, phase 3;
 * issue #21, issue #22).
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
 * {{profile_wizard_url}} points at /speaker/profile (issue #22's wizard),
 * which edits the CANONICAL `speakers/{id}` record an organizer approves —
 * not /profile, the attendee `users/{uid}` record. The invite/acceptance
 * caller (functions/src/speakers/invites.cjs) is what resolves the token;
 * this module only names what the button says.
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

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{speaker_name}},</p>',
    '<p style="margin:0 0 16px 0;">Thank you — your place at {{event_name}} is confirmed, and this invitation is now linked to your account.</p>',
    '<p style="margin:0 0 16px 0;">Next, write your speaker profile — your biography, photograph, and organization — for the public programme:</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{profile_wizard_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Write your speaker profile</a>',
    '</p>',
    '<p style="margin:0;">Your speaker profile appears publicly once an organizer has reviewed it.</p>',
  ].join('\n')
);

const text = [
  'Hi {{speaker_name}},',
  '',
  'Thank you — your place at {{event_name}} is confirmed, and this invitation is now linked to your account.',
  '',
  'Next, write your speaker profile — your biography, photograph, and organization — for the public programme:',
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
