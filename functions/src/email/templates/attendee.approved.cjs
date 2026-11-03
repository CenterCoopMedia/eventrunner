'use strict';

/**
 * attendee.approved: sent once when an organizer approves an attendee's
 * account (ADR 0008 §5, users/approval.cjs). `registration_url` is empty
 * when the form asks no questions, and the `{{#if}}` then drops the whole
 * paragraph. It carries no credential, so the email log keeps its body.
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{attendee_name}},</p>',
    '<p style="margin:0 0 16px 0;">An organizer approved your registration. You are registered for {{event_name}}.</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{dashboard_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Open your dashboard</a>',
    '</p>',
    '{{#if registration_url}}<p style="margin:0 0 16px 0;">If you have not answered the registration questions yet, <a href="{{registration_url}}">answer them here</a>.</p>{{/if}}',
    '<p style="margin:0;">Questions? Reply to this message.</p>',
  ].join('\n'),
);

const text = [
  'Hi {{attendee_name}},',
  '',
  'An organizer approved your registration. You are registered for {{event_name}}.',
  '',
  'Open your dashboard:',
  '{{dashboard_url}}',
  '',
  '{{#if registration_url}}If you have not answered the registration questions yet, answer them here:\n{{registration_url}}\n\n{{/if}}Questions? Reply to this message.',
  '',
  TEXT_FOOTER,
].join('\n');

module.exports = {
  id: 'attendee.approved',
  subject: 'You are registered for {{event_name}}',
  html,
  text,
  tokens: [...GLOBAL_TOKEN_NAMES, 'attendee_name', 'dashboard_url', 'registration_url'],
  requiredTokens: ['dashboard_url'],
  storeRendered: true,
};
