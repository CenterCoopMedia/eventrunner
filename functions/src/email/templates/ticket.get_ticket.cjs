'use strict';

/**
 * ticket.get_ticket — the registration prompt a brand-new signup gets when
 * no ticket exists yet (spec §6.2, §3.5; issue #33).
 *
 * Provider-parameterized, not merely tokenized (§3.5): `{{cta_label}}`,
 * `{{cta_url}}`, and `{{provider_note}}` are supplied by
 * `TicketingProvider.getRegistrationPrompt()`, never by the config layer,
 * and this template is never rendered at all when the provider returns
 * `send: false` — that decision is made by the caller
 * (ticketing/registrationPrompt.cjs), not here.
 *
 * The CTA button is a `{{#if cta_url}}...{{/if}}` conditional block
 * (render.cjs), not a token substituted into an always-present button: the
 * `manual` provider's `action: 'await_approval'` case returns `ctaUrl: null`
 * on purpose (an organizer confirms the account by hand, there is nothing
 * to click), and a button whose `href` merely went empty would still LOOK
 * like an action the reader could take. `{{provider_note}}` and
 * `{{registration_closes}}` are each optional the same way — a deployment
 * with no `config/event.registration.closesAt` renders no closing-date
 * sentence rather than an empty one.
 *
 * No regional transit directions or named hotels here (§6.2) — that copy is
 * CMS content on the seeded travel page (§5.3), linked by `{{site_url}}`;
 * the venue fields below are only name/address/map, from config.
 */

const { wrap } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

const html = wrap(
  [
    '<p style="margin:0 0 16px 0;">Hi {{first_name}},</p>',
    '<p style="margin:0 0 16px 0;">You are signed up for {{event_name}} ({{event_dates}}), but your registration is not complete yet.</p>',
    '{{#if provider_note}}',
    '<p style="margin:0 0 16px 0;">{{provider_note}}</p>',
    '{{/if}}',
    '{{#if cta_url}}',
    '<p style="margin:0 0 16px 0;text-align:center;">',
    '<a href="{{cta_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">{{cta_label}}</a>',
    '</p>',
    '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">If the button does not work, paste this address into your browser:<br>{{cta_url}}</p>',
    '{{/if}}',
    '{{#if registration_closes}}',
    '<p style="margin:0 0 16px 0;">Registration closes {{registration_closes}}.</p>',
    '{{/if}}',
    '<p style="margin:0;">Venue: {{venue_name}}, {{venue_address}}. See <a href="{{site_url}}/travel">travel and venue details</a> for directions and lodging.</p>',
  ].join('\n')
);

const text = [
  'Hi {{first_name}},',
  '',
  'You are signed up for {{event_name}} ({{event_dates}}), but your registration is not complete yet.',
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
  '{{#if registration_closes}}',
  'Registration closes {{registration_closes}}.',
  '',
  '{{/if}}',
  'Venue: {{venue_name}}, {{venue_address}}. Travel and venue details: {{site_url}}/travel',
  '',
  '--',
  '{{postal_address_html}}',
].join('\n');

module.exports = {
  id: 'ticket.get_ticket',
  subject: 'Complete your registration for {{event_name}}',
  html,
  text,
  // The full §6.2 global vocabulary is declared so admin overrides may
  // reference any global token without tripping the unknown-token check.
  tokens: [
    ...GLOBAL_TOKEN_NAMES,
    'first_name',
    'cta_label',
    'cta_url',
    'provider_note',
    'registration_closes',
  ],
  // No required token: unlike an OTP code or an invite link, this mail
  // remains a complete, useful message with every one of its
  // provider-parameterized fields absent (the `await_approval` case sends
  // no CTA at all and is still correct — §3.5).
  requiredTokens: [],
  storeRendered: true,
};
