'use strict';

/**
 * auth.otp — emailed sign-in code (spec §6.2, phase 2).
 *
 * requiredTokens: ['code'] — an override that drops {{code}} from either
 * body is rejected at save time and falls back at render time, because a
 * well-formed mail without the code still burns a rate-limit slot (§6.1).
 * storeRendered: false — a rendered OTP must never persist.
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Here is your sign-in code for {{event_name}}:</p>',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<span style="display:inline-block;padding:12px 24px;background-color:#f4f4f4;border:1px solid #e0e0e0;font-family:Courier,monospace;font-size:28px;font-weight:bold;letter-spacing:6px;color:#333333;">{{code}}</span>',
    '</p>',
    '<p style="margin:0 0 16px 0;">This code expires in {{expiry_minutes}} minutes.</p>',
    '<p style="margin:0;">If you did not request this code, you can ignore this email — or let us know at <a href="mailto:{{support_email}}">{{support_email}}</a>.</p>',
  ].join('\n')
);

const text = [
  'Here is your sign-in code for {{event_name}}:',
  '',
  '{{code}}',
  '',
  'This code expires in {{expiry_minutes}} minutes.',
  '',
  'If you did not request this code, you can ignore this email — or let us know at {{support_email}}.',
].join('\n');

module.exports = {
  id: 'auth.otp',
  subject: 'Your {{event_name}} sign-in code',
  html,
  text,
  // The full §6.2 global vocabulary is declared so admin overrides may
  // reference any global token without tripping the unknown-token check.
  tokens: [...GLOBAL_TOKEN_NAMES, 'code', 'expiry_minutes'],
  requiredTokens: ['code'],
  storeRendered: false,
};
