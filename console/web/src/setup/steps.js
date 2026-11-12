import { CONSOLE_REQUEST_CLIENT_LABELS } from 'shared/consoleRequest';
// The steps of the guided setup (ADR 0007 §3 and the 2026-11-04 amendment), in
// order. `id` is the key the server uses in `answers`, `errors` and
// `progress`; `path` is the last part of the step's address.

export const STEPS = Object.freeze([
  { id: 'organization', path: 'organization', title: 'Your organization' },
  { id: 'event', path: 'event', title: 'Your event' },
  { id: 'webAddress', path: 'web-address', title: 'Your web address' },
  { id: 'team', path: 'team', title: 'Your team' },
  { id: 'tickets', path: 'tickets', title: 'Tickets' },
  { id: 'email', path: 'email', title: 'Email' },
  { id: 'review', path: 'review', title: 'Review' },
  { id: 'agreement', path: 'agreement', title: 'Agreement' },
]);

/** The steps whose answers the server saves. Team and Review save nothing. */
export const ANSWER_STEPS = Object.freeze(['organization', 'event', 'webAddress', 'tickets', 'email']);

/** The same words the server uses when a request cannot pass Review. */
export const SIGNUPS_CLOSED = 'This site is not taking sign-ups right now. We saved your answers. Try again later.';

/**
 * The ids of the steps open now. The server has the last word. The agreement
 * opens when the answers all pass and the site is taking sign-ups. Accepting
 * it starts the build and ends the setup.
 *
 * @param {object} app the request as getApplication returns it
 * @param {string[]} refusedSteps steps whose last change the server did not save
 */
export function openStepIds(app, refusedSteps = []) {
  const answers = STEPS.map((step) => step.id).filter((id) => id !== 'agreement');
  const ready = app.status === 'draft' && app.signups?.open
    && Object.keys(app.errors).length === 0 && refusedSteps.length === 0;
  return ready ? [...answers, 'agreement'] : answers;
}

export const SITE_DOMAIN = 'eventrunner.org';

/** The most days an event can have. The server refuses more (answers.cjs MAX_DAYS). */
export const MAX_DAYS = 14;

export function stepByPath(path) {
  return STEPS.find((step) => step.path === path) || null;
}

export function stepById(id) {
  return STEPS.find((step) => step.id === id) || null;
}

/** The step a field path belongs to, for example 'event.days.0.date' -> event. */
export function stepOfField(path) {
  return stepById(String(path).split('.')[0]);
}

/** The errors of one step. */
export function errorsOfStep(errors, id) {
  return Object.fromEntries(
    Object.entries(errors || {}).filter(([path]) => path === id || path.startsWith(`${id}.`)),
  );
}

export function setupPath(orgId, appId, step) {
  return `/organizations/${orgId}/applications/${appId}/${step.path}`;
}

export function statusPath(orgId, appId) {
  return `/organizations/${orgId}/applications/${appId}`;
}

export const TICKET_CHOICES = Object.freeze([
  { value: 'stripe', label: 'Sell with Stripe', help: 'Sell tickets on your site. The money goes to your own Stripe account.', connect: true },
  { value: 'eventbrite', label: 'Use Eventbrite', help: 'Keep selling on Eventbrite. Your site shows the tickets people buy there.', connect: true },
  { value: 'spreadsheet', label: 'Import a spreadsheet later', help: 'Your staff upload a list of registrations in the admin panel.', connect: false },
  { value: 'none', label: 'No tickets', help: 'Your site has no tickets or registrations.', connect: false },
]);

/** What the client reads in place of the status while a build has failed. */
export const BUILD_FAILED_LABEL = 'We did not finish building your site';

/** The client's words for each request status (shared/consoleRequest). */
export const STATUS_LABELS = CONSOLE_REQUEST_CLIENT_LABELS;
