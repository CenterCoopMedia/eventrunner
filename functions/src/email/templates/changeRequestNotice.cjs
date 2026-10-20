'use strict';

/**
 * Shared body builder for the three change request notices (issue #330):
 * changeRequest.received, changeRequest.done and changeRequest.declined.
 *
 * FIXED WORDING. These emails are sent with the shipped wording only:
 * admin/changeRequestNotices.cjs renders them with no override, so a stored
 * `email_templates/{id}` document never changes them, and no editor offers
 * them. A change to this wording is a code change, reviewed like one.
 *
 * NO REQUEST TEXT. No token carries the request's message, its page, a
 * staff reply or a result link. The email states that something happened
 * and points the requester to their own change requests page
 * (`{{requests_url}}`), where they read the details after they sign in. So
 * no free text from a requester or from staff is ever put in an email, and
 * a forwarded email shows nothing of the request.
 *
 * NEVER "LIVE". The done email says the event team marked the request done.
 * It does not say the change is live: staff record the outcome, and nothing
 * in this repository publishes a change on its own (issue #330).
 */

const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES, internals: { escapeHtml } } = require('../render.cjs');

const TOKENS = Object.freeze([...GLOBAL_TOKEN_NAMES, 'requests_url']);

/** The fixed subject and lead paragraph of each notice. */
const WORDING = Object.freeze({
  'changeRequest.received': {
    subject: 'We got your change request for {{event_name}}',
    lead: 'We got your change request. The event team will read it.',
    link: 'You can check its status at any time on your change requests page:',
  },
  'changeRequest.done': {
    subject: 'Your change request for {{event_name}} is marked done',
    lead: 'The event team marked your change request as done.',
    link: 'You can see its status, and any reply from the team, on your change requests page:',
  },
  'changeRequest.declined': {
    subject: 'An update on your change request for {{event_name}}',
    lead: 'The event team decided not to make the change you asked for.',
    link: 'You can see its status, and any reply from the team, on your change requests page:',
  },
});

/**
 * The shipped template module for one notice id.
 * @param {keyof typeof WORDING} id
 */
function changeRequestNoticeTemplate(id) {
  const { subject, lead, link } = WORDING[id];
  const html = wrap([
    '<p style="margin:0 0 16px 0;">Hello,</p>',
    `<p style="margin:0 0 16px 0;">${escapeHtml(lead)}</p>`,
    `{{#if requests_url}}<p style="margin:0 0 16px 0;">${escapeHtml(link)}<br><a href="{{requests_url}}">{{requests_url}}</a></p>{{/if}}`,
    '<p style="margin:0;">You do not need to reply to this email.</p>',
  ].join('\n'));
  const text = [
    'Hello,',
    '',
    lead,
    '',
    `{{#if requests_url}}${link}\n{{requests_url}}\n\n{{/if}}You do not need to reply to this email.`,
    '',
    TEXT_FOOTER,
  ].join('\n');
  return { id, subject, html, text, tokens: TOKENS, requiredTokens: [], storeRendered: true };
}

module.exports = { changeRequestNoticeTemplate, WORDING };
