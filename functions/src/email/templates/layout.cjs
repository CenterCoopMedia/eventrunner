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
  'logo_url',
  'event_name',
  'event_dates',
  'venue_name',
  'operator_name',
  'postal_address_html',
  'social_links_html',
  'social_links_text',
  'support_email',
];

/**
 * The plain-text footer every template's text body ends with: the event,
 * venue and host's postal block, then social accounts, one "Service: link" line each
 * (config/event.social.handles, #231).
 *
 * The accounts sit inside `{{#if social_links_text}}`, blank line and all,
 * so an event that lists none gets no extra separator or trailing blank line.
 */
const TEXT_FOOTER = [
  '--',
  '{{event_name}}',
  '{{event_dates}}, {{venue_name}}',
  'Hosted by {{postal_address_html}}{{#if social_links_text}}',
  '',
  '{{social_links_text}}{{/if}}',
].join('\n');

/**
 * Wrap inner body HTML in the shared header/footer chrome.
 *
 * @param {string} innerHtml template-specific content; tokens unrendered
 * @param {{ preheader?: string }} [options] optional inbox preview; tokens unrendered
 * @returns {string} full HTML document with tokens unrendered
 */
function wrap(innerHtml, { preheader = '' } = {}) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;">',
    preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : '',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">',
    '<tr><td align="center" style="padding:24px 0;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-top:6px solid {{brand_primary}};">',
    '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:28px 32px 20px 32px;border-bottom:1px solid #e6e6e6;">',
    '<p style="margin:0;font-family:Merriweather,Georgia,\'Times New Roman\',serif;font-size:22px;line-height:1.3;font-weight:bold;color:{{brand_primary}};">{{event_name}}</p>',
    '<p style="margin:6px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.4;color:#555555;">{{event_dates}} &middot; {{venue_name}}</p>',
    '</td></tr>',
    '<tr><td style="padding:28px 32px 32px 32px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#111111;">',
    innerHtml,
    '</td></tr>',
    // Keep the host's uploaded raster logo on a white cell in mail clients.
    '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 32px 28px 32px;border-top:1px solid #e6e6e6;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#676767;">',
    '{{#if logo_url}}<p style="margin:0 0 6px 0;">Hosted by</p><img src="{{logo_url}}" alt="{{operator_name}}" width="120" style="display:block;width:120px;height:auto;border:0;margin:0 0 14px 0;">{{/if}}',
    '<p style="margin:0 0 8px 0;">{{postal_address_html}}</p>',
    // The event's social accounts (#231). Guarded on the TEXT token because
    // `{{#if}}` reads plain values only; both are empty together, so an
    // event with no account gets no row at all rather than an empty one.
    '{{#if social_links_text}}<p style="margin:0 0 8px 0;">{{social_links_html}}</p>{{/if}}',
    '<p style="margin:0;">Questions? Write to <a href="mailto:{{support_email}}" style="color:#676767;">{{support_email}}</a>.</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = { wrap, LAYOUT_TOKENS, TEXT_FOOTER };
