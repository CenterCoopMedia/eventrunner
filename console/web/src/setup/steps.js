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
  { id: 'fee', path: 'fee', title: 'Event fee' },
]);

/** The steps whose answers the server saves. Team and Review save nothing. */
export const ANSWER_STEPS = Object.freeze(['organization', 'event', 'webAddress', 'tickets', 'email']);

/** The same words the server uses when a request cannot pass Review. */
export const SIGNUPS_CLOSED = 'This site is not taking sign-ups right now. We saved your answers. Try again later.';

/**
 * The ids of the steps open now. The server has the last word. The answers
 * stay open until an Owner accepts the agreement; the agreement opens when
 * they all pass and the site is taking sign-ups; the fee opens on acceptance.
 *
 * @param {object} app the request as getApplication returns it
 * @param {string[]} refusedSteps steps whose last change the server did not save
 */
export function openStepIds(app, refusedSteps = []) {
  if (app.status === 'awaiting_payment') return ['agreement', 'fee'];
  const answers = STEPS.map((step) => step.id).filter((id) => id !== 'agreement' && id !== 'fee');
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

export const CONNECT_LATER = 'You connect this account after we approve your request.';

/** What the client reads for each status (ADR 0007 §3 and §5). */
export const STATUS_LABELS = Object.freeze({
  draft: 'Not sent yet',
  awaiting_payment: 'Waiting for the event fee',
  submitted: 'We are reviewing your request',
  changes_requested: 'Changes needed',
  approved: 'We are building your site',
  building: 'We are building your site',
  ready: 'Your site is ready',
  launched: 'Your site is open to the public',
  withdrawn: 'Withdrawn',
  declined: 'We cannot build this site',
});
