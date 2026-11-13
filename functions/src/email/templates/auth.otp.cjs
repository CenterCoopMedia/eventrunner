'use strict';

/**
 * auth.otp — emailed sign-in code (spec §6.2, phase 2).
 *
 * requiredTokens: ['code'] — an override that drops {{code}} from either
 * body is rejected at save time and falls back at render time, because a
 * well-formed mail without the code still burns a rate-limit slot (§6.1).
 * storeRendered: false — a rendered OTP must never persist.
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 20px 0;">Enter this code on the sign-in page to continue.</p>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">',
    '<tr><td align="center" style="border:1px solid #d6d6d6;border-radius:6px;padding:24px 12px 18px 12px;">',
    '<p style="margin:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#555555;">Your sign-in code</p>',
    '<span style="font-family:\'SF Mono\',Menlo,Consolas,\'Courier New\',monospace;font-size:40px;line-height:1;font-weight:bold;letter-spacing:10px;color:#111111;">{{code}}</span>',
    '<p style="margin:14px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#555555;">Expires in {{expiry_minutes}} minutes</p>',
    '</td></tr>',
    '</table>',
    '<p style="margin:0;color:#676767;font-size:14px;">If you did not ask for this code, you can ignore this email.</p>',
  ].join('\n'),
  { preheader: 'Your {{event_short_name}} sign-in code expires in {{expiry_minutes}} minutes.' }
);

const text = [
  '{{event_name}}',
  '',
  'Enter this code on the sign-in page to continue:',
  '',
  '{{code}}',
  '',
  'This code expires in {{expiry_minutes}} minutes.',
  '',
  'If you did not ask for this code, you can ignore this email.',
  '',
  'Questions? Write to {{support_email}}.',
  '',
  TEXT_FOOTER,
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
