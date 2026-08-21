'use strict';

/**
 * Launch-readiness evaluation — the seven rows of spec §5.1.1.
 *
 * Two callers, one table:
 *   - `init-event.cjs` prints it as WARNINGS and exits 0. Init must never
 *     fail on `legal.reviewRequired`: init itself sets that flag (§5.5), it
 *     is set before hosting exists, and the only way to clear it is the
 *     admin Settings UI that a non-zero exit would have blocked. Init is
 *     the gate on nothing.
 *   - `init-event.cjs --check` prints it and exits non-zero if any row is
 *     unmet. That is the gate on going live.
 *
 * Pure: takes an already-loaded snapshot of the deployment, returns rows.
 * Every row carries a `remedy` — the readiness table is only useful if it
 * says what to do about each unmet item, not merely that it is unmet.
 */

/** Default for the seeded-content row: zero sample blocks may remain. */
const DEFAULT_SEEDED_THRESHOLD = 0;

/** Minimum admin accounts (§5.6 item 7: never a single point of failure). */
const MIN_ADMINS = 2;

/**
 * Evaluate all seven rows.
 *
 * @param {{ event: object|null, providers: object|null, theme: object|null,
 *           bootstrap: object|null, seededContentCount: number,
 *           seededThreshold?: number }} snapshot
 * @returns {Array<{ id: string, label: string, ok: boolean, detail: string, remedy: string }>}
 */
function evaluateReadiness({
  event,
  providers,
  theme,
  bootstrap,
  seededContentCount = 0,
  seededThreshold = DEFAULT_SEEDED_THRESHOLD,
}) {
  const rows = [];
  const row = (id, label, ok, detail, remedy) => rows.push({ id, label, ok, detail, remedy });

  const reviewRequired = event?.legal?.reviewRequired;
  row(
    'legal',
    'Legal review',
    reviewRequired === false,
    reviewRequired === false
      ? 'privacy and terms marked reviewed'
      : 'config/event.legal.reviewRequired is still true',
    'Have the client review the seeded privacy and terms pages, then clear the flag from admin Settings.',
  );

  const verified = event?.sender?.domainVerified === true;
  row(
    'sender',
    'Sender domain',
    verified,
    verified
      ? `verified ${event?.sender?.domainVerifiedAt || ''}`.trim()
      : `${event?.sender?.email || 'sender'} not verified`,
    'Publish SPF, DKIM, and DMARC for the sender domain, then run scripts/verify-sender-domain.cjs.',
  );

  row(
    'seeded',
    'Seeded content',
    seededContentCount <= seededThreshold,
    `${seededContentCount} seeded block${seededContentCount === 1 ? '' : 's'} remain ` +
      `(threshold ${seededThreshold})`,
    'Replace the remaining [Replace] blocks in the admin CMS; editing a block clears its seeded flag.',
  );

  // A slot still listed in theme.placeholderLogos is still the neutral
  // stand-in init uploaded; replacing one through the admin media flow
  // removes it from the list.
  const placeholders = Array.isArray(theme?.placeholderLogos) ? theme.placeholderLogos : [];
  row(
    'branding',
    'Branding',
    placeholders.length === 0,
    placeholders.length === 0
      ? 'no placeholder branding assets remain'
      : `placeholder assets in: ${placeholders.join(', ')}`,
    'Upload the client logo, mark, favicon, and OG image from admin Settings → Branding.',
  );

  const admins = Array.isArray(bootstrap?.adminEmails) ? bootstrap.adminEmails : [];
  row(
    'admins',
    'First admin',
    admins.length >= MIN_ADMINS,
    `${admins.length} admin account${admins.length === 1 ? '' : 's'} configured`,
    `Grant a second admin so config/bootstrap is not a single point of failure (at least ${MIN_ADMINS}).`,
  );

  const ticketing = providers?.ticketing || {};
  const ticketingProvider = ticketing.provider || 'none';
  const needsWebhook = ticketingProvider !== 'none' && ticketingProvider !== 'manual';
  const ticketingOk = !needsWebhook || Boolean(ticketing.webhookRegisteredAt);
  row(
    'ticketing',
    'Ticketing',
    ticketingOk,
    needsWebhook
      ? (ticketingOk
        ? `webhook registered ${ticketing.webhookRegisteredAt}`
        : `${ticketingProvider} webhook not registered`)
      : `provider is ${ticketingProvider} — no webhook to register`,
    'Run scripts/register-ticketing-webhook.cjs and confirm the delivery in getTicketingStatus.',
  );

  // Operator-attested (§5.1.1): nothing in the Admin SDK reports whether a
  // sign-in provider is enabled or which domains are authorized, so the
  // operator records the manual §5.6 steps with `init-event.cjs
  // --attest-auth` and the attestation is what this row reads.
  const auth = event?.auth || {};
  const authOk = auth.googleProviderEnabled === true && auth.authorizedDomainsConfigured === true;
  row(
    'auth',
    'Auth',
    authOk,
    authOk
      ? `attested ${auth.attestedAt || ''} by ${auth.attestedBy || 'operator'}`.trim()
      : 'Google provider / authorized domains not attested',
    'Complete the Firebase Auth console steps, then record them with: init-event.cjs --attest-auth.',
  );

  return rows;
}

/** @param {Array<object>} rows @returns {boolean} */
function allReady(rows) {
  return rows.every((r) => r.ok);
}

/**
 * Fixed-width table, plus a remedy line under each unmet row. Returned as
 * a string (never printed here) so tests assert on the text.
 *
 * @param {Array<object>} rows
 * @returns {string}
 */
function formatReadinessTable(rows) {
  const labelWidth = Math.max(...rows.map((r) => r.label.length), 5);
  const lines = [];
  lines.push(`${'Check'.padEnd(labelWidth)}  Status  Detail`);
  lines.push(`${'-'.repeat(labelWidth)}  ------  ${'-'.repeat(40)}`);
  for (const r of rows) {
    lines.push(`${r.label.padEnd(labelWidth)}  ${r.ok ? '  ok  ' : ' UNMET'}  ${r.detail}`);
    if (!r.ok) lines.push(`${' '.repeat(labelWidth)}          → ${r.remedy}`);
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_SEEDED_THRESHOLD,
  MIN_ADMINS,
  evaluateReadiness,
  allReady,
  formatReadinessTable,
};
