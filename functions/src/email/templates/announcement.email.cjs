'use strict';

/**
 * announcement.email — the branded wrapper an announcement email is sent in
 * (issue #202). Staff write the subject, the message, and an optional link
 * in the admin panel (functions/src/announcements/compose.cjs).
 *
 * NOT IN THE OVERRIDE REGISTRY. templates.cjs does not list this id, so the
 * email template editor cannot change it, and an override cannot drop the
 * message slot or the unsubscribe line.
 *
 * Staff text never passes through the token engine. `{{announcement_body}}`
 * and `{{unsubscribe_url}}` receive placeholder values, and compose.cjs
 * puts the escaped message and each recipient's link in their place after
 * rendering. Braces a staff member types therefore stay as typed.
 *
 * The unsubscribe line is inside `{{#if unsubscribe_url}}`: it is present
 * when the application manages unsubscribes, and absent when the provider
 * adds its own link (a Postmark broadcast stream with Postmark handling).
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '{{announcement_body}}',
    '{{#if cta_url}}',
    '<p style="margin:8px 0 16px 0;">',
    '<a href="{{cta_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">{{cta_label}}</a>',
    '</p>',
    '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">If the button does not work, paste this address into your browser:<br>{{cta_url}}</p>',
    '{{/if}}',
    '{{#if unsubscribe_url}}',
    '<p style="margin:24px 0 0 0;font-size:13px;color:#777777;">This is an announcement from {{event_name}}. <a href="{{unsubscribe_url}}" style="color:#777777;">Unsubscribe from announcements</a>.</p>',
    '{{/if}}',
  ].join('\n'),
);

const text = [
  '{{announcement_body}}',
  '{{#if cta_url}}',
  '{{cta_label}}: {{cta_url}}',
  '{{/if}}',
  '{{#if unsubscribe_url}}',
  'This is an announcement from {{event_name}}.',
  'Unsubscribe from announcements: {{unsubscribe_url}}',
  '{{/if}}',
  '',
  TEXT_FOOTER,
].join('\n');

module.exports = {
  id: 'announcement.email',
  subject: '{{announcement_subject}}',
  html,
  text,
  tokens: [...GLOBAL_TOKEN_NAMES, 'announcement_subject', 'announcement_body', 'cta_url', 'cta_label', 'unsubscribe_url'],
  requiredTokens: ['announcement_body'],
  storeRendered: true,
};
