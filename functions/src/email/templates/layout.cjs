'use strict';

/**
 * Shared HTML wrapper for every transactional template (spec §6.1).
 *
 * wrap() returns a full email-safe document — table-based layout, inline
 * styles — with the tokens left UNRENDERED: render.cjs substitutes them
 * later against the loaded config. Brand colors come through tokens
 * ({{brand_primary}}), so only neutral greys appear as hex fallbacks here
 * (this directory is the one place ESLint permits hex literals).
 *
 * Any template whose html passes through wrap() must list LAYOUT_TOKENS in
 * its `tokens` array, or render.cjs's unknown-token check rejects it.
 */

/** Tokens referenced by the wrapper itself. */
const LAYOUT_TOKENS = [
  'brand_primary',
  'event_name',
  'postal_address_html',
  'support_email',
  'current_year',
];

/**
 * Wrap inner body HTML in the shared header/footer chrome.
 *
 * @param {string} innerHtml template-specific content; tokens unrendered
 * @returns {string} full HTML document with tokens unrendered
 */
function wrap(innerHtml) {
  return [
    '<!doctype html>',
    '<html>',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #e0e0e0;">',
    '<tr><td style="background-color:{{brand_primary}};padding:20px 32px;">',
    '<span style="font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;">{{event_name}}</span>',
    '</td></tr>',
    '<tr><td style="padding:32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#333333;">',
    innerHtml,
    '</td></tr>',
    '<tr><td style="padding:20px 32px;border-top:1px solid #e0e0e0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#777777;">',
    '<p style="margin:0 0 8px 0;">{{postal_address_html}}</p>',
    '<p style="margin:0;">Questions? Write to <a href="mailto:{{support_email}}" style="color:#777777;">{{support_email}}</a>.</p>',
    '<p style="margin:8px 0 0 0;">&copy; {{current_year}} {{event_name}}</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = { wrap, LAYOUT_TOKENS };
