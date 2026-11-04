// Shared words and small checks for the console pages.

/** The same simple check the server makes; the server has the last word. */
export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export const ROLE_LABELS = Object.freeze({ owner: 'Owner', editor: 'Editor' });

export const ROLE_HELP = Object.freeze({
  owner: 'Runs the event site and manages the team.',
  editor: 'Edits the event content.',
});

/** "an Owner" or "an Editor". */
export function withArticle(role) {
  return `an ${ROLE_LABELS[role] || 'Editor'}`;
}

/** A date for people, for example "10 November 2026". */
export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
