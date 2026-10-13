'use strict';

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

module.exports = {
  id: 'ticket.attendee_confirmation',
  subject: 'A ticket is ready for you at {{event_name}}',
  tokens: [...GLOBAL_TOKEN_NAMES, 'first_name', 'order_reference', 'ticket_count', 'cta_url'],
  requiredTokens: ['order_reference', 'ticket_count', 'cta_url'],
  storeRendered: false,
  html: wrap([
    '<p>Hi {{first_name}},</p>',
    '<p>{{ticket_count}} ticket(s) for {{event_name}} are assigned to this email address.</p>',
    '<p><a href="{{cta_url}}">Sign in and claim your ticket</a></p>',
    '<p>Your order reference is {{order_reference}}. Use this email address to sign in. The reference alone does not give anyone access to your ticket.</p>',
    '<p>After claiming, open My tickets to view or print your admission information.</p>',
  ].join('\n')),
  text: [
    'Hi {{first_name}},', '', '{{ticket_count}} ticket(s) for {{event_name}} are assigned to this email address.', '',
    'Sign in and claim your ticket: {{cta_url}}', '',
    'Order reference: {{order_reference}}',
    'Use this email address to sign in. The reference alone does not give anyone access to your ticket.',
    'After claiming, open My tickets to view or print your admission information.', '', TEXT_FOOTER,
  ].join('\n'),
};
