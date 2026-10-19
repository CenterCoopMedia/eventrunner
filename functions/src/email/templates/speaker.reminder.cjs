'use strict';

/**
 * speaker.reminder — what staff send an accepted speaker who still owes the
 * event something (functions/src/speakers/reminders.cjs).
 *
 * The items are FLAGS and plain lists, not prose: the wording of each line
 * lives here, in the template, so staff can rewrite every sentence through
 * an `email_templates/speaker.reminder` override (the admin's reminder
 * wording editor) while the token set stays fixed.
 *
 *   {{needs_bio}}, {{needs_headshot}}  "yes" when the item is missing,
 *                                      empty otherwise; each guards its line
 *   {{description_sessions}}           the titles of the speaker's sessions
 *                                      with no description, joined by "; "
 *   {{materials_sessions}}             the titles with no pending or
 *                                      approved material, joined the same way
 *
 * Session titles are staff-authored but still plain tokens, so the renderer
 * HTML-escapes them in the html body. No value here may populate an `_html`
 * token (render.cjs invariant).
 *
 * requiredTokens: ['dashboard_url'] — the reminder's job is to get the
 * speaker to the page where they act. An override that drops the link
 * leaves them with a list and nowhere to go.
 *
 * storeRendered: true — no bearer credential, so the ordinary sent_emails
 * audit applies and the email log can show what each speaker got.
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{speaker_name}},</p>',
    '<p style="margin:0 0 16px 0;">Thank you for speaking at {{event_name}}. We still need these items from you:</p>',
    '<ul style="margin:0 0 16px 0;padding-left:20px;">',
    '{{#if needs_bio}}<li>Add a short biography to your speaker profile.</li>{{/if}}',
    '{{#if needs_headshot}}<li>Add a headshot to your speaker profile.</li>{{/if}}',
    '{{#if description_sessions}}<li>Send us a description for: {{description_sessions}}.</li>{{/if}}',
    '{{#if materials_sessions}}<li>Send your slides or other materials for: {{materials_sessions}}.</li>{{/if}}',
    '</ul>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{dashboard_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Open your speaker dashboard</a>',
    '</p>',
    '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">If the button does not work, paste this address into your browser:<br>{{dashboard_url}}</p>',
    '<p style="margin:0;">Questions? Reply to this message or write to <a href="mailto:{{admin_contact_email}}">{{admin_contact_email}}</a>.</p>',
  ].join('\n')
);

const text = [
  'Hi {{speaker_name}},',
  '',
  'Thank you for speaking at {{event_name}}. We still need these items from you:',
  '',
  '{{#if needs_bio}}- Add a short biography to your speaker profile.',
  '{{/if}}{{#if needs_headshot}}- Add a headshot to your speaker profile.',
  '{{/if}}{{#if description_sessions}}- Send us a description for: {{description_sessions}}.',
  '{{/if}}{{#if materials_sessions}}- Send your slides or other materials for: {{materials_sessions}}.',
  '{{/if}}',
  'Open your speaker dashboard:',
  '{{dashboard_url}}',
  '',
  'Questions? Reply to this message or write to {{admin_contact_email}}.',
  '',
  TEXT_FOOTER,
].join('\n');

module.exports = {
  id: 'speaker.reminder',
  subject: 'Items we still need for {{event_name}}',
  html,
  text,
  tokens: [
    ...GLOBAL_TOKEN_NAMES,
    'speaker_name',
    'dashboard_url',
    'profile_url',
    'admin_contact_email',
    'needs_bio',
    'needs_headshot',
    'description_sessions',
    'materials_sessions',
  ],
  requiredTokens: ['dashboard_url'],
  storeRendered: true,
};
