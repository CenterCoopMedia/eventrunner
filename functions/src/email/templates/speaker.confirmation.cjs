'use strict';

/**
 * speaker.confirmation — a session-specific confirmation naming what an
 * organizer has locked in for a speaker: the session title, time, and room
 * (spec §6.2/§6.3, phase 3, issue #22).
 *
 * Unlike speaker.invite (a bearer credential) and speaker.accepted (a
 * one-time "the account is linked" event), this template's send point is
 * per SESSION, not per speaker: a speaker on three sessions gets three of
 * these, one per confirmed slot, which is why the caller keys its
 * send-once guard on `{speakerId}:{sessionId}` rather than `{speakerId}`
 * alone (see functions/src/speakers/confirmation.cjs).
 *
 * requiredTokens: ['session_title'] — a confirmation naming no session
 * confirms nothing; {{session_time}} and {{session_room}} stay declared but
 * NOT required, because a session can genuinely lack either (unscheduled,
 * or a virtual session with no room) without the confirmation itself being
 * meaningless the way a titleless one would be.
 *
 * storeRendered: true — this body carries no bearer credential, so the
 * ordinary `sent_emails` audit applies (the same reasoning speaker.accepted
 * gives).
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{speaker_name}},</p>',
    '<p style="margin:0 0 16px 0;">Your session at {{event_name}} is confirmed:</p>',
    '<p style="margin:0 0 16px 0;padding:12px 16px;background-color:#f4f4f4;">',
    '<strong>{{session_title}}</strong><br>',
    '{{session_time}}<br>',
    '{{session_room}}',
    '</p>',
    '<p style="margin:0;">Questions, or something looks wrong? Reply to this message or write to <a href="mailto:{{admin_contact_email}}">{{admin_contact_email}}</a>.</p>',
  ].join('\n'),
);

const text = [
  'Hi {{speaker_name}},',
  '',
  'Your session at {{event_name}} is confirmed:',
  '',
  '{{session_title}}',
  '{{session_time}}',
  '{{session_room}}',
  '',
  'Questions, or something looks wrong? Reply to this message or write to {{admin_contact_email}}.',
  '',
  '--',
  '{{postal_address_html}}',
].join('\n');

module.exports = {
  id: 'speaker.confirmation',
  subject: 'Your session at {{event_name}} is confirmed: {{session_title}}',
  html,
  text,
  tokens: [...GLOBAL_TOKEN_NAMES, 'speaker_name', 'session_title', 'session_time', 'session_room', 'admin_contact_email'],
  requiredTokens: ['session_title'],
  storeRendered: true,
};
