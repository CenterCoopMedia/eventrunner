'use strict';

/**
 * speaker.profile_received: sent once when a speaker submits the profile
 * steps (ADR 0008 §3, as amended 2026-11-03). It promises nothing about a
 * time or a room; `speaker.confirmation` does that, when staff confirm a
 * session. It carries no credential, so the email log keeps its body.
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{speaker_name}},</p>',
    '<p style="margin:0 0 16px 0;">Thank you. We have your speaker profile for {{event_name}}. An organizer reviews it before it appears on the public programme.</p>',
    '<p style="margin:0 0 16px 0;">You can still change it:</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{profile_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Open your speaker profile</a>',
    '</p>',
    '<p style="margin:0;">Questions? Reply to this message or write to <a href="mailto:{{admin_contact_email}}">{{admin_contact_email}}</a>.</p>',
  ].join('\n'),
);

const text = [
  'Hi {{speaker_name}},',
  '',
  'Thank you. We have your speaker profile for {{event_name}}. An organizer reviews it before it appears on the public programme.',
  '',
  'You can still change it:',
  '{{profile_url}}',
  '',
  'Questions? Reply to this message or write to {{admin_contact_email}}.',
  '',
  TEXT_FOOTER,
].join('\n');

module.exports = {
  id: 'speaker.profile_received',
  subject: 'We have your speaker profile for {{event_name}}',
  html,
  text,
  tokens: [...GLOBAL_TOKEN_NAMES, 'speaker_name', 'profile_url', 'admin_contact_email'],
  requiredTokens: ['profile_url'],
  storeRendered: true,
};
