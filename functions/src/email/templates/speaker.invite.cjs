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

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{speaker_name}},</p>',
    '<p style="margin:0 0 16px 0;">You are invited to take part in {{event_name}} ({{event_dates}}) as a {{invite_type}}.</p>',
    '<p style="margin:0 0 16px 0;">Use the link below to accept. You will be asked to sign in — with Google, or with a code we email you — so we can connect this invitation to your account.</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{invite_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Accept your invitation</a>',
    '</p>',
    '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">If the button does not work, paste this address into your browser:<br>{{invite_url}}</p>',
    '<p style="margin:0;">Questions, or the wrong person? Reply to this message or write to <a href="mailto:{{admin_contact_email}}">{{admin_contact_email}}</a>.</p>',
  ].join('\n')
);

const text = [
  'Hi {{speaker_name}},',
  '',
  'You are invited to take part in {{event_name}} ({{event_dates}}) as a {{invite_type}}.',
  '',
  'Accept your invitation:',
  '{{invite_url}}',
  '',
  'You will be asked to sign in — with Google, or with a code we email you — so we can connect this invitation to your account.',
  '',
  'Questions, or the wrong person? Reply to this message or write to {{admin_contact_email}}.',
  '',
  '--',
  '{{postal_address_html}}',
].join('\n');

module.exports = {
  id: 'speaker.invite',
  subject: 'You are invited to speak at {{event_name}}',
  html,
  text,
  // The full §6.2 global vocabulary is declared so admin overrides may
  // reference any global token without tripping the unknown-token check.
  tokens: [...GLOBAL_TOKEN_NAMES, 'speaker_name', 'invite_url', 'invite_type', 'admin_contact_email'],
  requiredTokens: ['invite_url'],
  storeRendered: false,
};
