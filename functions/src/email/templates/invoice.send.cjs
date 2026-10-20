'use strict';

/**
 * invoice.send: an issued or paid invoice, emailed by staff with its PDF
 * attached (issue #208, part 4; admin/invoiceEmail.cjs). The PDF is the
 * invoice; this message only says what is attached and when it is due.
 *
 * Every per-send value is plain text: render.cjs escapes it in the html
 * body, and admin/invoiceEmail.cjs cleans it to one line (the note keeps
 * its line breaks), so a name or a note cannot add markup or a header.
 * `staff_note` is optional and its block disappears when it is empty.
 *
 * `pay_link_url` is the open Stripe pay link of an issued invoice (#519),
 * a Stripe https address checked by admin/invoicePayLink.cjs; its block
 * disappears when there is none. `pay_link_end` says when it stops working.
 *
 * The wording is fixed in v1. No admin page edits it.
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">{{greeting}}</p>',
    '<p style="margin:0 0 16px 0;">{{invoice_summary}}</p>',
    '{{#if pay_link_url}}<p style="margin:0 0 8px 0;"><a href="{{pay_link_url}}">Pay by card</a> through Stripe.</p>',
    '<p style="margin:0 0 16px 0;">{{pay_link_end}}</p>{{/if}}',
    '{{#if staff_note}}<p style="margin:0 0 8px 0;font-weight:bold;">A note from {{issuer_name}}:</p>',
    '<p style="margin:0 0 16px 0;white-space:pre-line;">{{staff_note}}</p>{{/if}}',
    '<p style="margin:0;">If you have a question about this invoice, reply to this email.</p>',
  ].join('\n'),
);

const text = [
  '{{greeting}}',
  '',
  '{{invoice_summary}}',
  '',
  '{{#if pay_link_url}}Pay by card: {{pay_link_url}}\n{{pay_link_end}}\n\n{{/if}}' +
  '{{#if staff_note}}A note from {{issuer_name}}:\n{{staff_note}}\n\n{{/if}}If you have a question about this invoice, reply to this email.',
  '',
  TEXT_FOOTER,
].join('\n');

module.exports = {
  id: 'invoice.send',
  subject: 'Invoice {{invoice_number}} from {{issuer_name}}',
  html,
  text,
  tokens: [...GLOBAL_TOKEN_NAMES, 'invoice_number', 'issuer_name', 'greeting', 'invoice_summary', 'staff_note', 'pay_link_url', 'pay_link_end'],
  requiredTokens: [],
  storeRendered: true,
};
