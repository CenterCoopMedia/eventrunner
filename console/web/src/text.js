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

/** The same check the server makes on an organization name (organizations.cjs cleanName). */
export function cleanOrganizationName(value) {
  const name = String(value).trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 100 ? name : null;
}

export const ORGANIZATION_NAME_ERROR = 'Enter a name of 2 to 100 characters.';

/** How a new event site starts, for a reader looking for a way to start one. */
export const SIGNUP_LINK_HELP = 'Event sites start from a signup link, which you get once your invoice is paid. If you already have one, open it again.';

/** A date for people, for example "10 November 2026". */
export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Who a client reaches: the person the deployment names, or the team. */
export const hostName = () => import.meta.env.VITE_CONSOLE_HELP_NAME?.trim() || 'the hosting team';

/** The same, at the start of a sentence. */
export const HostName = () => hostName().replace(/^./, (first) => first.toUpperCase());
