// The steps of the "Set up your event" page (ADR 0007 §6), one per
// launch-readiness row in packages/shared/src/readiness.cjs.
//
// The server says only which rows are met (webMcpCheckEventReadiness). This
// file says what each row means to the client: who does it, what to do, and
// where to go. The order is the order a new client meets the work: the
// steps the client can do today first, then the steps that wait on DNS or
// the Event Runner team.
//
// `slug` is the step's own address (/admin/setup/<slug>), so a link in an
// email or the browser's Back button lands on one step.
//
// `owner` is 'you' (the client's admins), 'host' (the Event Runner team), or
// 'both'. `link.operator` marks a screen only an
// operator can open, so a staff reader sees the step without a dead link.

export const OWNER_WORDS = Object.freeze({
  you: 'You',
  host: 'Event Runner team',
  both: 'You and the Event Runner team',
});

export const SETUP_STEPS = Object.freeze([
  {
    id: 'admins',
    slug: 'team',
    title: 'Add a second operator',
    owner: 'you',
    todo: 'Your event has one operator. Add a second operator, so you keep access if one person leaves or loses their inbox.',
    done: 'Two or more operators manage the event.',
    link: { to: '/admin/access', label: 'Open Access', operator: true },
  },
  {
    id: 'branding',
    slug: 'logos',
    title: 'Upload your logos',
    owner: 'you',
    todo: 'Replace the placeholder logo, mark, footer mark, favicon and social image with your own files.',
    done: 'Your own logos are on the site.',
    link: { to: '/admin/branding', label: 'Open Branding', operator: true },
  },
  {
    id: 'seeded',
    slug: 'text',
    title: 'Replace the placeholder text',
    owner: 'you',
    todo: 'Some content blocks still show placeholder text that starts with [Replace]. Edit and save each one.',
    done: 'No placeholder text is left.',
    link: { to: '/admin/content', label: 'Open Content' },
  },
  {
    id: 'legal',
    slug: 'legal',
    title: 'Approve the privacy policy and terms',
    owner: 'you',
    todo: 'The site has a first draft of your privacy policy and terms. Your legal counsel must review and edit them. Then an operator marks the review complete here.',
    done: 'Your counsel approved the privacy policy and terms.',
    link: { to: '/admin/content/privacy', label: 'Open the privacy policy' },
  },
  {
    id: 'sender',
    slug: 'email',
    title: 'Set up your event email',
    owner: 'both',
    todo: 'The Event Runner team sets up the address your event sends email from and checks it. If you send from your own domain, they tell you exactly what to add. Until this is done, sign-in codes can go to spam.',
    done: 'Your event email is set up and checked.',
    link: { to: '/admin/settings', label: 'Open Event settings' },
  },
  {
    id: 'ticketing',
    slug: 'tickets',
    title: 'Connect ticket sales',
    owner: 'you',
    todo: 'Connect your ticket provider in the Event Runner console. The site then checks that orders reach it. Never paste a provider key into this site.',
    done: 'Ticket sales are connected, or the event has no ticket provider.',
    link: { to: '/admin/ticketing', label: 'Open Ticketing' },
  },
  {
    id: 'auth',
    slug: 'sign-in',
    title: 'Turn on Google sign-in',
    owner: 'host',
    todo: 'The Event Runner team turns on Google sign-in after your site is built. You do not need to do anything.',
    done: 'Google sign-in works on your web address.',
    link: null,
  },
]);

/**
 * Join the server's checks to the steps above, in the steps' order. A check
 * this file does not know (a row added to the policy later) is kept, under
 * the server's own label and owned by the Event Runner team, so a new row is
 * never hidden from the client.
 *
 * @param {Array<{ name: string, label: string, state: string }>} checks
 * @returns {Array<object>} steps, each with `ready: boolean`
 */
export function joinSetupSteps(checks) {
  const byName = new Map((Array.isArray(checks) ? checks : []).map((check) => [check.name, check]));
  const known = SETUP_STEPS
    .filter((step) => byName.has(step.id))
    .map((step) => ({ ...step, ready: byName.get(step.id).state === 'ready' }));
  const unknown = [...byName.values()]
    .filter((check) => !SETUP_STEPS.some((step) => step.id === check.name))
    .map((check) => ({
      id: check.name,
      slug: check.name,
      title: check.label,
      owner: 'host',
      todo: 'The Event Runner team completes this step.',
      done: 'This step is done.',
      link: null,
      ready: check.state === 'ready',
    }));
  return [...known, ...unknown];
}

/**
 * The step a reader lands on at /admin/setup: the first one not done, or the
 * first step when every one is done.
 *
 * @param {Array<{ ready: boolean }>} steps
 * @returns {number} an index into `steps`, or -1 when there are none
 */
export function firstOpenStep(steps) {
  if (steps.length === 0) return -1;
  const open = steps.findIndex((step) => !step.ready);
  return open === -1 ? 0 : open;
}
