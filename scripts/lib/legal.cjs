'use strict';

/**
 * Provider-aware privacy and terms templates (spec §5.5).
 *
 * The pre-v1 site shipped both documents as React components with prose
 * naming one university as operator, describing a magic-link sign-in the
 * platform does not have, and naming one ticketing vendor unconditionally.
 * Here the text is composed from what the deployment actually is:
 *
 *   - `operatorName` comes from `config/event.legal.operatorName`; no
 *     organization is ever named by the template itself.
 *   - the ticketing clause is emitted ONLY when a ticketing vendor is
 *     configured — a `manual` or `none` deployment's privacy policy never
 *     mentions one, because for that deployment there is nothing to
 *     disclose.
 *   - the email clause names the configured provider category, and the
 *     sign-in clause describes emailed one-time codes plus (when enabled)
 *     Google sign-in. Magic links are never described: v1 has no such
 *     mechanism.
 *
 * Every clause whose correct wording depends on jurisdiction, retention
 * policy, or a processor list carries a literal `[Client legal review
 * required]` marker, and both pages seed with
 * `config/event.legal.reviewRequired = true`. The templates are a starting
 * point for the client's counsel; they never assert another organization's
 * terms.
 *
 * Pure: returns block definitions, writes nothing.
 */

/** Marker text repeated on every clause needing counsel's attention. */
const REVIEW_MARKER = '[Client legal review required]';

/** How each ticketing provider is described, or null for "do not mention". */
const TICKETING_DISCLOSURE = Object.freeze({
  eventbrite: 'a third-party ticketing platform',
  manual: null,
  none: null,
});

/** How each email provider is described in the processors clause. */
const EMAIL_DISCLOSURE = Object.freeze({
  postmark: 'a third-party transactional email provider',
  webhook: 'an email relay operated on behalf of the organizer',
  console: null,
});

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** `<p>…</p>` with the marker appended, so no clause loses its flag. */
function clause(text, { marked = true } = {}) {
  return `<p>${escapeHtml(text)}${marked ? ` ${escapeHtml(REVIEW_MARKER)}` : ''}</p>`;
}

/**
 * Sentence naming the sign-in mechanisms this deployment actually offers.
 *
 * @param {{ googleSignIn?: boolean }} auth
 * @returns {string}
 */
function signInSentence(auth = {}) {
  const methods = ['a one-time code emailed to the address you enter'];
  if (auth.googleSignIn) methods.push('Google sign-in');
  const joined = methods.length === 1 ? methods[0] : `${methods.slice(0, -1).join(', ')} or ${methods.at(-1)}`;
  return `Signing in uses ${joined}. We do not use passwords.`;
}

/**
 * The privacy-policy blocks, keyed by section.
 *
 * @param {{ operatorName: string, supportEmail: string,
 *           ticketingProvider?: string, emailProvider?: string,
 *           googleSignIn?: boolean }} ctx
 * @returns {Array<{ section: string, field: string, blockType: string, value: string }>}
 */
function buildPrivacyBlocks(ctx) {
  const operator = ctx.operatorName || '[Replace] Operator name';
  const support = ctx.supportEmail || '[Replace] support address';
  const ticketing = TICKETING_DISCLOSURE[ctx.ticketingProvider] ?? null;
  const email = EMAIL_DISCLOSURE[ctx.emailProvider] ?? null;

  const processors = ['our hosting and database provider'];
  if (email) processors.push(email);
  if (ticketing) processors.push(ticketing);

  const blocks = [
    {
      section: 'privacy_intro',
      field: 'summary',
      blockType: 'richtext',
      value: clause(
        `${operator} operates this event site and is responsible for the personal information ` +
        'described here. This template describes how the site works today; it has not been reviewed by counsel.',
      ),
    },
    {
      section: 'privacy_data',
      field: 'account',
      blockType: 'richtext',
      value: clause(
        'When you create an account we store the email address you sign in with, the name and ' +
        'profile details you choose to provide, and the sessions you bookmark.',
      ),
    },
    {
      section: 'privacy_data',
      field: 'signin',
      blockType: 'richtext',
      value: clause(signInSentence(ctx)),
    },
    {
      section: 'privacy_sharing',
      field: 'processors',
      blockType: 'richtext',
      value: clause(
        `We share personal information with the service providers that run this site: ${processors.join(', ')}. ` +
        'We do not sell personal information.',
      ),
    },
    {
      section: 'privacy_retention',
      field: 'period',
      blockType: 'richtext',
      value: clause(
        '[Replace] State how long attendee records are kept after the event ends and what is deleted.',
      ),
    },
    {
      section: 'privacy_rights',
      field: 'requests',
      blockType: 'richtext',
      value: clause(
        '[Replace] State which access, correction, and deletion rights apply in this event ' +
        'jurisdiction and how a person exercises them.',
      ),
    },
    {
      section: 'privacy_contact',
      field: 'address',
      blockType: 'richtext',
      value: clause(`Questions about this policy go to ${support}.`, { marked: false }),
    },
  ];
  if (ticketing) {
    blocks.splice(4, 0, {
      section: 'privacy_sharing',
      field: 'ticketing',
      blockType: 'richtext',
      value: clause(
        `Registration is handled through ${ticketing}. Information you give that platform is covered ` +
        'by its own privacy policy, and we receive the attendee details it passes back to us.',
      ),
    });
  }
  return blocks;
}

/**
 * The terms-of-service blocks, keyed by section.
 *
 * @param {{ operatorName: string, supportEmail: string, conductEmail?: string,
 *           ticketingProvider?: string, googleSignIn?: boolean }} ctx
 * @returns {Array<{ section: string, field: string, blockType: string, value: string }>}
 */
function buildTermsBlocks(ctx) {
  const operator = ctx.operatorName || '[Replace] Operator name';
  const support = ctx.supportEmail || '[Replace] support address';
  const conduct = ctx.conductEmail || support;
  const ticketing = TICKETING_DISCLOSURE[ctx.ticketingProvider] ?? null;

  const blocks = [
    {
      section: 'terms_intro',
      field: 'summary',
      blockType: 'richtext',
      value: clause(
        `These terms cover the use of this event site, operated by ${operator}. This template ` +
        'describes how the site works today; it has not been reviewed by counsel.',
      ),
    },
    {
      section: 'terms_accounts',
      field: 'eligibility',
      blockType: 'richtext',
      value: clause(
        `${signInSentence(ctx)} You are responsible for the accuracy of what you publish in your profile ` +
        'and for keeping access to your email address.',
      ),
    },
    {
      section: 'terms_conduct',
      field: 'expectations',
      blockType: 'richtext',
      value: clause(
        `Attendees agree to the event code of conduct. Reports go to ${conduct}, and accounts may be ` +
        'suspended for conduct violations.',
        { marked: false },
      ),
    },
    {
      section: 'terms_liability',
      field: 'disclaimer',
      blockType: 'richtext',
      value: clause(
        '[Replace] State the warranty disclaimer, limitation of liability, and governing law for this ' +
        'event jurisdiction.',
      ),
    },
    {
      section: 'terms_contact',
      field: 'address',
      blockType: 'richtext',
      value: clause(`Questions about these terms go to ${support}.`, { marked: false }),
    },
  ];
  if (ticketing) {
    blocks.splice(3, 0, {
      section: 'terms_registration',
      field: 'tickets',
      blockType: 'richtext',
      value: clause(
        `Registration and any payment are handled through ${ticketing} under its own terms. ` +
        '[Replace] State the refund and transfer policy for this event.',
      ),
    });
  }
  return blocks;
}

/**
 * Both legal pages' seeded content, ready to be turned into cmsContent
 * docs by the seed writer.
 *
 * @param {{ event: object, providers: object, features?: object }} config
 * @returns {{ privacy: object[], terms: object[], reviewRequired: true }}
 */
function buildLegalContent({ event, providers, features = {} }) {
  const ctx = {
    operatorName: event?.legal?.operatorName || '',
    supportEmail: event?.legal?.supportEmail || '',
    conductEmail: event?.legal?.conductEmail || '',
    ticketingProvider: providers?.ticketing?.provider || 'none',
    emailProvider: providers?.email?.provider || 'console',
    // Google sign-in is a manual Firebase Auth step (§5.6 item 1); the
    // attestation on config/event is the only thing that knows it happened.
    googleSignIn: Boolean(event?.auth?.googleProviderEnabled ?? features.googleSignIn),
  };
  return {
    privacy: buildPrivacyBlocks(ctx),
    terms: buildTermsBlocks(ctx),
    reviewRequired: true,
  };
}

module.exports = {
  REVIEW_MARKER,
  TICKETING_DISCLOSURE,
  EMAIL_DISCLOSURE,
  buildPrivacyBlocks,
  buildTermsBlocks,
  buildLegalContent,
  internals: { clause, signInSentence, escapeHtml },
};
