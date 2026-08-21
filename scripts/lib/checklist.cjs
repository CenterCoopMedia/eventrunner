'use strict';

/**
 * The manual checklist init prints (spec §5.6) — the steps a deploy cannot
 * automate, plus the first-admin bootstrap steps that make the printed
 * list actionable rather than a reminder that something is missing.
 *
 * Kept as data so it is one list: `init-event.cjs` prints it, and
 * docs/CLIENT_ONBOARDING.md quotes it. Provider-aware, because a checklist
 * item a `manual`-ticketing deployment can never complete is an item
 * operators learn to ignore (§5.6 item 5).
 */

/**
 * @param {{ providers?: object, adminEmails?: string[], publicUrl?: string|null,
 *           hostingSite?: string|null, senderEmail?: string|null }} ctx
 * @returns {Array<{ title: string, detail: string }>}
 */
function manualChecklist(ctx = {}) {
  const ticketing = ctx.providers?.ticketing?.provider || 'none';
  const senderDomain = (ctx.senderEmail || '').split('@')[1] || 'the sender domain';
  const admins = Array.isArray(ctx.adminEmails) ? ctx.adminEmails : [];
  const items = [
    {
      title: 'Firebase Console → Authentication → Sign-in method → enable Google',
      detail:
        'Set the project support email and the public-facing app name; both appear in the consent dialog. ' +
        'Emailed one-time codes work without this, Google sign-in does not.',
    },
    {
      title: 'Firebase Console → Authentication → Settings → Authorized domains',
      detail:
        `Add the client custom domain${ctx.publicUrl ? ` (${ctx.publicUrl})` : ''} and the Hosting default ` +
        `domain${ctx.hostingSite ? ` (${ctx.hostingSite}.web.app)` : ''}. Sign-in fails on any domain not listed.`,
    },
    {
      title: 'Firebase Hosting → add the custom domain',
      detail: 'Complete DNS verification and wait for certificate issuance before announcing the site.',
    },
    {
      title: `Email provider → verify ${senderDomain}`,
      detail:
        'Publish SPF, DKIM, and a DMARC policy in the client DNS, then confirm with ' +
        'scripts/verify-sender-domain.cjs. Emailed sign-in codes are unreliable until this passes.',
    },
    ticketing === 'none'
      ? {
        title: 'Ticketing → nothing to do',
        detail: 'EVENT_TICKETING_PROVIDER is none: there is no token, no webhook, and no import step.',
      }
      : ticketing === 'manual'
        ? {
          title: 'Ticketing → upload the first attendee CSV',
          detail: 'The manual provider has no webhook to register; the CSV import is the equivalent step.',
        }
        : {
          title: 'Ticketing → create the API token, then register the webhook',
          detail:
            `Provider is ${ticketing}: run scripts/register-ticketing-webhook.cjs and confirm the delivery ` +
            'in getTicketingStatus.',
        },
    {
      title: 'Google Cloud Console → confirm the Cloud Billing API is enabled',
      detail:
        'For the deploying service account. Without it the functions deploy fails its pre-flight check ' +
        'with a 403 that reads like an unrelated error.',
    },
    {
      title: 'First admin signs in and confirms the admin panel loads',
      detail:
        (admins.length > 0
          ? `Seeded admins: ${admins.join(', ')}. `
          : 'No admin addresses were seeded — re-run with --admin. ') +
        'Then grant a second admin through the UI so config/bootstrap is not a single point of failure.',
    },
    {
      title: 'Record the Auth steps once done',
      detail:
        'Run: node scripts/init-event.cjs --attest-auth  — the launch-readiness Auth row is operator-attested ' +
        'because nothing in the Admin SDK reports whether a sign-in provider is enabled.',
    },
  ];
  return items;
}

/** @param {Array<{title: string, detail: string}>} items @returns {string} */
function formatChecklist(items) {
  return items
    .map((item, i) => `${String(i + 1).padStart(2, ' ')}. ${item.title}\n    ${item.detail}`)
    .join('\n');
}

module.exports = { manualChecklist, formatChecklist };
