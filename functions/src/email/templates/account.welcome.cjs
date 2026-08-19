'use strict';

/**
 * account.welcome — first-sign-in welcome (spec §6.2, phase 2).
 *
 * requiredTokens: ['login_url'] — the mail's whole job is getting the
 * reader back into the site. {{next_steps_html}} resolves only through
 * render.cjs's HTML_TOKEN_RESOLVERS (config/code, never per-send).
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{first_name}},</p>',
    '<p style="margin:0 0 16px 0;">Welcome to {{event_name}}! Your account is ready.</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{login_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">Sign in</a>',
    '</p>',
    '<p style="margin:0 0 8px 0;">A few things to do next:</p>',
    '{{next_steps_html}}',
    '<p style="margin:16px 0 0 0;">You can update your details any time on <a href="{{profile_url}}">your profile</a>.</p>',
  ].join('\n')
);

const text = [
  'Hi {{first_name}},',
  '',
  'Welcome to {{event_name}}! Your account is ready.',
  '',
  'Sign in: {{login_url}}',
  '',
  'A few things to do next:',
  '{{next_steps_html}}',
  '',
  // The stripped _html list loses its link targets; text readers get them
  // explicitly.
  'Schedule: {{schedule_url}}',
  '',
  'You can update your details any time on your profile: {{profile_url}}',
].join('\n');

module.exports = {
  id: 'account.welcome',
  subject: 'Welcome to {{event_name}}',
  html,
  text,
  // The full §6.2 global vocabulary is declared so admin overrides may
  // reference any global token without tripping the unknown-token check.
  tokens: [...GLOBAL_TOKEN_NAMES, 'first_name', 'profile_url', 'next_steps_html'],
  requiredTokens: ['login_url'],
  storeRendered: true,
};
