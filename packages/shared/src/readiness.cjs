'use strict';

const DEFAULT_SEEDED_THRESHOLD = 0;
const MIN_ADMINS = 2;

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

function allReady(rows) {
  return rows.every((row) => row.ok);
}

function formatReadinessTable(rows) {
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 5);
  const lines = [];
  lines.push(`${'Check'.padEnd(labelWidth)}  Status  Detail`);
  lines.push(`${'-'.repeat(labelWidth)}  ------  ${'-'.repeat(40)}`);
  for (const row of rows) {
    lines.push(`${row.label.padEnd(labelWidth)}  ${row.ok ? '  ok  ' : ' UNMET'}  ${row.detail}`);
    if (!row.ok) lines.push(`${' '.repeat(labelWidth)}          → ${row.remedy}`);
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

