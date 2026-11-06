'use strict';

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

module.exports = {
  id: 'admin.access_granted',
  subject: 'Your {{event_name}} admin access',
  html: wrap([
    '<p>You have {{access_role}} access to the admin panel for {{event_name}}.</p>',
    '<p><a href="{{admin_url}}">Open the admin panel</a>: {{admin_url}}</p>',
    '<p>Use this exact email address: <strong>{{access_email}}</strong>. Request an emailed sign-in code, then enter the code from your inbox to sign in.</p>',
    '{{#if access_ends}}<p>Your access ends {{access_ends}}.</p>{{/if}}',
  ].join('\n')),
  text: [
    'You have {{access_role}} access to the admin panel for {{event_name}}.',
    '',
    'Open the admin panel: {{admin_url}}',
    '',
    'Use this exact email address: {{access_email}}. Request an emailed sign-in code, then enter the code from your inbox to sign in.',
    '{{#if access_ends}}\nYour access ends {{access_ends}}.{{/if}}',
    '',
    TEXT_FOOTER,
  ].join('\n'),
  tokens: [...GLOBAL_TOKEN_NAMES, 'access_role', 'access_email', 'admin_url', 'access_ends'],
  requiredTokens: ['event_name', 'access_role', 'access_email', 'admin_url'],
  storeRendered: true,
};
