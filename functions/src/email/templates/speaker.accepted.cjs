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

const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');
const { buildSpeakerWording } = require('../speakerWordingFields.cjs');

const source = buildSpeakerWording('speaker.accepted');

module.exports = {
  id: 'speaker.accepted',
  ...source,
  tokens: [...GLOBAL_TOKEN_NAMES, 'speaker_name', 'profile_wizard_url', 'deadline'],
  requiredTokens: ['profile_wizard_url'],
  storeRendered: true,
};
