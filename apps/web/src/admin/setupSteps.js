// The steps of the "Set up your event" page (ADR 0007 §6), one per
// launch-readiness row in packages/shared/src/readiness.cjs.
//
// The server says only which rows are met (webMcpCheckEventReadiness). This
// file says what each row means to the client: who does it, what to do, and
// where to go. The order is the order a new client meets the work: the
// steps the client can do today first, then the steps that wait on DNS or
// the hosting team.
//
// `owner` is 'you' (the client's admins), 'host' (the hosting team that
// deploys the site), or 'both'. `link.operator` marks a screen only an
// operator can open, so a staff reader sees the step without a dead link.

export const OWNER_WORDS = Object.freeze({
  you: 'You',
  host: 'Hosting team',
  both: 'You and the hosting team',
});

export const SETUP_STEPS = Object.freeze([
  {
    id: 'admins',
    title: 'Add a second operator',
    owner: 'you',
    todo: 'Your event has one operator. Add a second operator, so you keep access if one person leaves or loses their inbox.',
    done: 'Two or more operators manage the event.',
    link: { to: '/admin/access', label: 'Open Access', operator: true },
  },
  {
    id: 'branding',
    title: 'Upload your logos',
    owner: 'you',
    todo: 'Replace the placeholder logo, mark, footer mark, favicon and social image with your own files.',
    done: 'Your own logos are on the site.',
    link: { to: '/admin/branding', label: 'Open Branding', operator: true },
  },
  {
    id: 'seeded',
    title: 'Replace the placeholder text',
    owner: 'you',
    todo: 'Some content blocks still show placeholder text that starts with [Replace]. Edit and save each one.',
    done: 'No placeholder text is left.',
    link: { to: '/admin/content', label: 'Open Content' },
  },
  {
    id: 'legal',
    title: 'Approve the privacy policy and terms',
    owner: 'you',
    todo: 'The site has a first draft of your privacy policy and terms. Your legal counsel must review and edit them. Then an operator marks the review complete here.',
    done: 'Your counsel approved the privacy policy and terms.',
    link: { to: '/admin/content', label: 'Open Content' },
  },
  {
    id: 'sender',
    title: 'Verify your email domain',
    owner: 'both',
    todo: 'Add the SPF, DKIM and DMARC records from the hosting team to the DNS of your sender domain. The hosting team then checks them. Without them, sign-in codes can go to spam.',
    done: 'Your sender domain is verified.',
    link: { to: '/admin/settings', label: 'Open Event settings' },
  },
  {
    id: 'ticketing',
    title: 'Connect ticket sales',
    owner: 'host',
    todo: 'The hosting team connects your ticket provider and checks that orders reach the site. Send provider keys to the hosting team directly. Never paste a key into this site.',
    done: 'Ticket sales are connected, or the event has no ticket provider.',
    link: { to: '/admin/ticketing', label: 'Open Ticketing' },
  },
  {
    id: 'auth',
    title: 'Turn on Google sign-in',
    owner: 'host',
    todo: 'The hosting team turns on Google sign-in and adds your web address to the allowed list.',
    done: 'Google sign-in works on your web address.',
    link: null,
  },
]);

/**
 * Join the server's checks to the steps above, in the steps' order. A check
 * this file does not know (a row added to the policy later) is kept, under
 * the server's own label and owned by the hosting team, so a new row is
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
      title: check.label,
      owner: 'host',
      todo: 'The hosting team completes this step.',
      done: 'This step is done.',
      link: null,
      ready: check.state === 'ready',
    }));
  return [...known, ...unknown];
}
