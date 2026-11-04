// Words and small checks for the hosting team's review pages (ADR 0007 §5).
// The server makes the same checks and has the last word.

export const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  awaiting_payment: 'Waiting for payment',
  submitted: 'Waiting for review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  building: 'Building',
  ready: 'Ready',
  launched: 'Launched',
  withdrawn: 'Withdrawn',
  declined: 'Declined',
});

/** The queue filters, in the order the hosting team works through them. */
export const STATUS_FILTERS = Object.freeze([
  'submitted', 'awaiting_payment', 'changes_requested', 'approved', 'building', 'ready', 'launched', 'declined', 'withdrawn', 'draft',
]);

export const TICKET_LABELS = Object.freeze({
  stripe: 'Sell with Stripe',
  eventbrite: 'Use Eventbrite',
  spreadsheet: 'Import a spreadsheet later',
  none: 'No tickets',
});

export const NOTE_MAX = 2000;

/** A time for people, for example "4 November 2026, 10:00". */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const SETTING_FIELDS = Object.freeze({
  gcpFolder: {
    label: 'Google Cloud folder',
    hint: 'The folder number, for example folders/123456789012.',
    error: 'Enter the Google Cloud folder number, for example folders/123456789012.',
    valid: (v) => /^(?:folders\/)?\d{6,20}$/.test(v.trim()),
  },
  billingAccount: {
    label: 'Billing account',
    hint: 'For example 012345-6789AB-CDEF01.',
    error: 'Enter the billing account, for example 012345-6789AB-CDEF01.',
    valid: (v) => /^(?:billingAccounts\/)?[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/i.test(v.trim()),
  },
  region: {
    label: 'Region',
    hint: 'For example us-central1.',
    error: 'Enter a Google Cloud region, for example us-central1.',
    valid: (v) => /^[a-z]+-[a-z]+\d{1,2}$/.test(v.trim().toLowerCase()),
  },
  projectId: {
    label: 'Project id',
    hint: '6 to 30 characters: lowercase letters, digits and hyphens. Starts with a letter.',
    error: 'Enter a project id of 6 to 30 characters: lowercase letters, digits and hyphens. Start with a letter. Do not end with a hyphen.',
    valid: (v) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v.trim()),
  },
  environment: {
    label: 'Environment name',
    hint: 'The GitHub Environment for the deploy. Lowercase letters, digits and hyphens.',
    error: 'Enter an environment name of up to 63 characters: lowercase letters, digits and hyphens.',
    valid: (v) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(v.trim()),
  },
  feeAmount: {
    label: 'Amount',
    hint: 'A whole number in the smallest unit of the currency, for example cents.',
    error: 'Enter the amount as a whole number in the smallest unit of the currency.',
    valid: (v) => /^[1-9]\d{0,7}$/.test(v.trim()),
  },
  feeCurrency: {
    label: 'Currency',
    hint: 'The three-letter code, for example usd.',
    error: 'Enter a three-letter currency code.',
    valid: (v) => /^[a-z]{3}$/i.test(v.trim()),
  },
});

/** @returns {{ field: string, message: string } | null} the first value that fails its check */
export function firstSettingError(values, fields) {
  for (const field of fields) {
    if (!SETTING_FIELDS[field].valid(String(values[field] ?? ''))) return { field, message: SETTING_FIELDS[field].error };
  }
  return null;
}
