'use strict';

/**
 * The Event Runner frame for mail that Event Runner itself sends to an
 * operator, as opposed to mail an event sends in its own brand (layout.cjs).
 * It matches the console's frame (console/functions/src/emailLayout.cjs):
 * the console deploys as its own package, so the two cannot share a file.
 * Keep them in step. Every value passed in is already escaped.
 */

const ACCENT = '#1a5296';
const INK = '#17181a';
const MUTED = '#505359';
const RULE = '#dadada';
const PANEL = '#f0f0ef';
const FONT = 'Helvetica,Arial,sans-serif';

/**
 * @param {{ context?: string, title: string, paragraphs?: string[],
 *   rows?: Array<[string, string]>, link?: { href: string, text: string } | null,
 *   footer?: string }} parts escaped HTML
 * @returns {string}
 */
function eventRunnerEmail({ context = '', title, paragraphs = [], rows = [], link = null, footer = 'Event Runner' }) {
  const details = rows.length
    ? [
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background-color:${PANEL};border-left:3px solid ${ACCENT};">`,
      '<tr><td style="padding:16px 20px;">',
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0">',
      ...rows.map(([label, value], i) => [
        '<tr>',
        `<td style="padding:${i ? 8 : 0}px 16px 0 0;font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">${label}</td>`,
        `<td style="padding:${i ? 8 : 0}px 0 0 0;font-family:${FONT};font-size:14px;color:${INK};vertical-align:top;word-break:break-word;white-space:pre-wrap;">${value}</td>`,
        '</tr>',
      ].join('')),
      '</table>',
      '</td></tr>',
      '</table>',
    ].join('\n')
    : '';
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background-color:#f4f4f4;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid ${RULE};">`,
    `<tr><td style="background-color:${ACCENT};padding:20px 32px;">`,
    `<span style="font-family:${FONT};font-size:20px;font-weight:bold;color:#ffffff;">Event Runner</span>`,
    '</td></tr>',
    `<tr><td style="padding:32px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};">`,
    context ? `<p style="margin:0 0 6px 0;font-size:13px;color:${MUTED};">${context}</p>` : '',
    `<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:1.3;color:${INK};">${title}</h1>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 16px 0;">${p}</p>`),
    details,
    link ? `<p style="margin:8px 0 0 0;"><a href="${link.href}" style="display:inline-block;padding:12px 20px;background-color:${ACCENT};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:bold;text-decoration:none;border-radius:6px;">${link.text}</a></p>` : '',
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

module.exports = { eventRunnerEmail };
