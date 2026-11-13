'use strict';

/**
 * speaker.invite — the invitation an organizer sends a speaker (spec §6.2,
 * phase 3; issue #21).
 *
 * requiredTokens: ['invite_url'] — the same reasoning §6.1 gives for
 * auth.otp's {{code}}. This mail carries a bearer credential and nothing
 * else gets the speaker into the pipeline: an override that drops the link
 * renders a well-formed, useless invitation, and the speaker's only recovery
 * is asking an admin to resend a token that will be equally useless. The
 * check runs at save time (saveEmailTemplate) and again at render time.
 *
 * storeRendered: false — the rendered body contains the invite token, and
 * `sent_emails` is admin-readable (spec §3.1: "never persist rendered
 * content for auth mail"). An invite link is exactly that: possession of it
 * is what acceptSpeakerInvite trusts, so it must not be readable from an
 * audit row long after the mail was delivered.
 *
 * The event name, dates, venue, sender identity, and site URLs are all
 * tokens — §6.3 makes tokenizing these three speaker templates part of the
 * invite port's definition of done, because a non-CJS deployment cannot
 * test the pipeline without sending wrong-event mail to a real inbox.
 */

const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');
const { buildSpeakerWording } = require('./speakerWordingFields.cjs');

const source = buildSpeakerWording('speaker.invite');

module.exports = {
  id: 'speaker.invite',
  buildWording: (fields) => buildSpeakerWording('speaker.invite', fields),
  ...source,
  // The full §6.2 global vocabulary is declared so admin overrides may
  // reference any global token without tripping the unknown-token check.
  tokens: [...GLOBAL_TOKEN_NAMES, 'speaker_name', 'invite_url', 'invite_type', 'admin_contact_email'],
  requiredTokens: ['invite_url'],
  storeRendered: false,
};
