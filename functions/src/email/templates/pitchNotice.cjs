'use strict';

/**
 * Shared body builder for the three pitch emails (issue #324):
 * pitch.receipt, pitch.accepted and pitch.declined.
 *
 * Operators edit plain wording, not markup. This module turns that wording
 * into both bodies, so the html and the text always say the same thing and
 * the html always keeps the shared layout. The wording is HTML-escaped
 * before the {{token}} placeholders are filled, and render.cjs escapes each
 * token value again, so neither the wording nor a pitch title can add markup.
 *
 * The decision emails end with an optional note to the submitter
 * ({{submitter_feedback}}), written by staff when they send the email. No
 * token carries the private review notes, so no wording can send them.
 */

const { PITCH_NOTICE_DEFAULTS } = require('shared/pitch');
const { wrap, TEXT_FOOTER } = require('./layout.cjs');
const { GLOBAL_TOKEN_NAMES, internals: { escapeHtml } } = require('../render.cjs');

const RECEIPT_TOKENS = Object.freeze([...GLOBAL_TOKEN_NAMES, 'pitch_title']);
const DECISION_TOKENS = Object.freeze([...RECEIPT_TOKENS, 'submitter_feedback']);

const FEEDBACK_HTML = [
  '{{#if submitter_feedback}}<p style="margin:0 0 8px 0;font-weight:bold;">A note from the organizers:</p>',
  '<p style="margin:0 0 16px 0;white-space:pre-line;">{{submitter_feedback}}</p>{{/if}}',
].join('\n');
const FEEDBACK_TEXT = '{{#if submitter_feedback}}A note from the organizers:\n{{submitter_feedback}}\n\n{{/if}}';

function paragraphs(wording) {
  return String(wording).trim().split(/\n[ \t]*\n\s*/).map((part) => part.trim()).filter(Boolean);
}

/**
 * @param {string} wording plain text; a blank line starts a paragraph
 * @param {{ feedback: boolean }} options true for the decision emails
 * @returns {{ html: string, text: string }}
 */
function buildPitchNoticeBodies(wording, { feedback }) {
  const parts = paragraphs(wording);
  const html = wrap([
    ...parts.map((part) => `<p style="margin:0 0 16px 0;">${escapeHtml(part).replace(/\n/g, '<br>')}</p>`),
    ...(feedback ? [FEEDBACK_HTML] : []),
  ].join('\n'));
  const text = `${parts.join('\n\n')}\n\n${feedback ? FEEDBACK_TEXT : ''}${TEXT_FOOTER}`;
  return { html, text };
}

/** The override render.cjs and validateOverridePayload check for edited wording. */
function pitchNoticeOverride(id, { subject, wording }) {
  return { subject, ...buildPitchNoticeBodies(wording, { feedback: id !== 'pitch.receipt' }) };
}

/** The shipped template module for one pitch email id. */
function pitchNoticeTemplate(id) {
  const { subject, wording } = PITCH_NOTICE_DEFAULTS[id];
  return {
    id,
    ...pitchNoticeOverride(id, { subject, wording }),
    tokens: id === 'pitch.receipt' ? RECEIPT_TOKENS : DECISION_TOKENS,
    requiredTokens: [],
    storeRendered: true,
  };
}

module.exports = { buildPitchNoticeBodies, pitchNoticeOverride, pitchNoticeTemplate, RECEIPT_TOKENS, DECISION_TOKENS };
