'use strict';

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');

module.exports = {
  id: 'ticket.order_confirmation',
  subject: 'Your ticket order for {{event_name}}',
  tokens: [...GLOBAL_TOKEN_NAMES, 'order_reference', 'ticket_count', 'total_amount', 'cta_url'],
  requiredTokens: ['order_reference', 'ticket_count', 'total_amount', 'cta_url'],
  storeRendered: false,
  html: wrap([
    '<p>Your order for {{event_name}} is confirmed.</p>',
    '<p>Order: {{order_reference}}<br>Tickets: {{ticket_count}}<br>Total: {{total_amount}}</p>',
    '<p><a href="{{cta_url}}">Open your event profile</a></p>',
    '<p>Each attendee needs to sign in with the email assigned to their ticket and claim it. Your payment receipt, when applicable, comes separately from Stripe.</p>',
  ].join('\n')),
  text: [
    'Your order for {{event_name}} is confirmed.', '',
    'Order: {{order_reference}}', 'Tickets: {{ticket_count}}', 'Total: {{total_amount}}', '',
    'Open your event profile: {{cta_url}}', '',
    'Each attendee needs to sign in with the email assigned to their ticket and claim it. Your payment receipt, when applicable, comes separately from Stripe.',
    '', TEXT_FOOTER,
  ].join('\n'),
};
