'use strict';

/**
 * ticket.claim_prompt — sent when a ticket exists for the account's address
 * but nobody has claimed it yet (spec §6.2, §3.5; issue #33).
 *
 * Same provider-parameterization rule as ticket.get_ticket.cjs:
 * `{{cta_label}}`, `{{cta_url}}`, and `{{provider_note}}` come from
 * `TicketingProvider.getRegistrationPrompt()`, and the CTA button is a
 * `{{#if cta_url}}...{{/if}}` conditional block, omitted entirely rather
 * than rendered with an empty `href` — every shipped provider (eventbrite,
 * manual) currently returns `ctaUrl: null` for this trigger because the
 * self-service claim page did not exist before this issue built it
 * (functions/src/ticketing/providers/manual.cjs, eventbrite.cjs); this
 * template is written to also work once a provider starts returning one.
 *
 * `{{ticket_class}}` is optional too — a CSV import row or an Eventbrite
 * attendee record can carry a null `ticketClass` (§3.3 TicketRecord), and
 * the sentence reads fine without naming a ticket tier.
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{first_name}},</p>',
    '<p style="margin:0 0 16px 0;">There is a ticket for {{event_name}} ({{event_dates}}) waiting to be claimed at this address',
    '{{#if ticket_class}}',
    ' ({{ticket_class}})',
    '{{/if}}',
    '.</p>',
    '{{#if provider_note}}',
    '<p style="margin:0 0 16px 0;">{{provider_note}}</p>',
    '{{/if}}',
    '{{#if cta_url}}',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{cta_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">{{cta_label}}</a>',
    '</p>',
    '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">If the button does not work, paste this address into your browser:<br>{{cta_url}}</p>',
    '{{/if}}',
  ].join('\n')
);

const text = [
  'Hi {{first_name}},',
  '',
  'There is a ticket for {{event_name}} ({{event_dates}}) waiting to be claimed at this address' +
    '{{#if ticket_class}} ({{ticket_class}}){{/if}}.',
  '',
  '{{#if provider_note}}',
  '{{provider_note}}',
  '',
  '{{/if}}',
  '{{#if cta_url}}',
  '{{cta_label}}:',
  '{{cta_url}}',
  '',
  '{{/if}}',
  '--',
  '{{postal_address_html}}',
].join('\n');

module.exports = {
  id: 'ticket.claim_prompt',
  subject: 'Claim your ticket for {{event_name}}',
  html,
  text,
  // The full §6.2 global vocabulary is declared so admin overrides may
  // reference any global token without tripping the unknown-token check.
  tokens: [
    ...GLOBAL_TOKEN_NAMES,
    'first_name',
    'ticket_class',
    'cta_label',
    'cta_url',
    'provider_note',
  ],
  // No required token — see ticket.get_ticket.cjs for the same reasoning:
  // every provider-parameterized field can legitimately be absent.
  requiredTokens: [],
  storeRendered: true,
};
