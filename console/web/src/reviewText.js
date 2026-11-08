// Words and small checks for the hosting team's pages (ADR 0007 §5).
// The server makes the same checks and has the last word.

export const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  approved: 'Approved',
  building: 'Building',
  ready: 'Ready',
  launched: 'Launched',
  withdrawn: 'Withdrawn',
  declined: 'Declined',
  archived: 'Archived',
});

/** The queue filters, in the order the hosting team works through them. */
export const STATUS_FILTERS = Object.freeze([
  'approved', 'building', 'ready', 'launched', 'draft', 'declined', 'withdrawn', 'archived',
]);

export const LINK_STATUS_LABELS = Object.freeze({
  open: 'Open',
  used: 'Used',
  revoked: 'Revoked',
  expired: 'Expired',
});

export const TICKET_LABELS = Object.freeze({
  stripe: 'Sell with Stripe',
  eventbrite: 'Use Eventbrite',
  spreadsheet: 'Import a spreadsheet later',
  none: 'No tickets',
});

export const NOTE_MAX = 2000;

/** A time for people, for example "4 November 2026, 10:00". */
/** "14:30" as "2:30 p.m.", for a client reading their own answers. */
function clockText(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? '');
  if (!match) return time ?? '';
  const hour = Number(match[1]);
  const suffix = hour < 12 ? 'a.m.' : 'p.m.';
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}

/**
 * One event day as plain text, for example
 * "Thursday, 15 April 2027, 9:00 a.m. to 5:00 p.m. (Workshops)".
 * The date is a calendar date, so it is read at noon UTC to keep its day.
 */
export function eventDayText(day) {
  const date = new Date(`${day?.date}T12:00:00Z`);
  // An impossible draft date such as 2027-02-30 shows as typed, not as the
  // day the browser would roll it over to.
  const real = !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day?.date;
  const dateText = !real
    ? (day?.date ?? '')
    : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const hours = day?.startTime && day?.endTime ? `${clockText(day.startTime)} to ${clockText(day.endTime)}` : '';
  const label = day?.label ? ` (${day.label})` : '';
  return `${[dateText, hours].filter(Boolean).join(', ')}${label}`;
}

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
});

/** @returns {{ field: string, message: string } | null} the first value that fails its check */
export function firstSettingError(values, fields) {
  for (const field of fields) {
    if (!SETTING_FIELDS[field].valid(String(values[field] ?? ''))) return { field, message: SETTING_FIELDS[field].error };
  }
  return null;
}
