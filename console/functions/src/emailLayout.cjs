'use strict';

/**
 * The Event Runner frame for console email: the same table layout and
 * inline styles as the event sites' mail (functions/src/email/templates/
 * layout.cjs), with the Event Runner name and the console's accent in the
 * band. Mail clients need literal hex, so this file is on the ESLint hex
 * allowlist. The colors are the console's light brand tokens
 * (console/web/src/styles.css).
 */

const ACCENT = '#1a5296';
const INK = '#17181a';
const MUTED = '#505359';
const RULE = '#dadada';
const PANEL = '#f0f0ef';
const FONT = 'Helvetica,Arial,sans-serif';

/** A full email document around `innerHtml`, which the caller has escaped. */
function wrapConsoleEmail(innerHtml, { preheader = '', footer = 'Event Runner client console' } = {}) {
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;">',
    preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : '',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid ${RULE};">`,
    `<tr><td style="background-color:${ACCENT};padding:20px 32px;">`,
    `<span style="font-family:${FONT};font-size:20px;font-weight:bold;color:#ffffff;">Event Runner</span>`,
    '</td></tr>',
    `<tr><td style="padding:32px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};">`,
    innerHtml,
    '</td></tr>',
    `<tr><td style="padding:20px 32px;border-top:1px solid ${RULE};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">`,
    `<p style="margin:0;">${footer}</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n');
}

/** The message's heading. `text` is escaped by the caller. */
function heading(text) {
  return `<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:1.3;color:${INK};">${text}</h1>`;
}

/** A small muted line above the heading, such as the organization and event. Escaped by the caller. */
function kicker(text) {
  return `<p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;color:${MUTED};">${text}</p>`;
}

/** A paragraph. `html` is escaped by the caller. */
function paragraph(html, last = false) {
  return `<p style="margin:0 0 ${last ? 0 : 16}px 0;">${html}</p>`;
}

/** Small muted print, such as how long a link works. Escaped by the caller. */
function fineprint(html) {
  return `<p style="margin:24px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${html}</p>`;
}

/** A quoted note, such as a reviewer's note. Escaped by the caller. */
function note(label, html) {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background-color:${PANEL};border-left:3px solid ${ACCENT};">`,
    `<tr><td style="padding:16px 20px;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK};">`,
    `<p style="margin:0 0 6px 0;font-size:13px;font-weight:bold;color:${MUTED};">${label}</p>`,
    `<p style="margin:0;">${html}</p>`,
    '</td></tr>',
    '</table>',
  ].join('\n');
}

/** Label and value rows on a light panel. Values are escaped by the caller. */
function detailsTable(rows) {
  const cells = rows.map(([label, value], i) => [
    '<tr>',
    `<td style="padding:${i ? 8 : 0}px 16px 0 0;font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">${label}</td>`,
    `<td style="padding:${i ? 8 : 0}px 0 0 0;font-family:${FONT};font-size:14px;font-weight:bold;color:${INK};vertical-align:top;">${value}</td>`,
    '</tr>',
  ].join(''));
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background-color:${PANEL};border-left:3px solid ${ACCENT};">`,
    '<tr><td style="padding:16px 20px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">',
    ...cells,
    '</table>',
    '</td></tr>',
    '</table>',
  ].join('\n');
}

/** A button link. `href` and `text` are escaped by the caller. */
function button(href, text) {
  return `<p style="margin:8px 0 0 0;"><a href="${href}" style="display:inline-block;padding:12px 20px;background-color:${ACCENT};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:bold;text-decoration:none;border-radius:6px;">${text}</a></p>`;
}

module.exports = { button, detailsTable, fineprint, heading, kicker, note, paragraph, wrapConsoleEmail };
