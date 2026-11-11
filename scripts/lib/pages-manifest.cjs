'use strict';

/**
 * The public guide map. Engineering records stay in GitHub.
 *
 * Every published page is listed here explicitly. One source Markdown file
 * maps to exactly one stable route, so a document cannot appear twice, and
 * nothing reaches the site by being dropped into a directory. Historical
 * planning records (`docs/plans/**`) are deliberately absent: they stay
 * readable on GitHub, but they are not public navigation. LEGACY_PAGES
 * preserves old engineering URLs with noindex handoff pages only.
 *
 * `route` is relative to the documentation root, `docs/` under the site's
 * path base (scripts/lib/pages-site.cjs). Order inside a section is reading
 * order, and it drives the previous/next links.
 */

const { pagesSite } = require('./pages-site.cjs');

const REPO_URL = 'https://github.com/CenterCoopMedia/eventrunner';
const REPO_BLOB = `${REPO_URL}/blob/main/`;

const SECTIONS = Object.freeze([
  {
    id: 'start',
    title: 'Start here',
    summary: 'Understand the service, choose your next step, and get your team ready.',
    pages: [
      {
        source: 'docs/handbook/overview.md',
        route: 'overview/',
        title: 'Meet Event Runner',
        summary: 'What your event site can do and how to explore it.',
      },
      {
        source: 'docs/handbook/for-clients.md',
        route: 'handbook/for-clients/',
        title: 'For event organizers',
        summary: 'What your organization manages, what we handle, and how to start.',
      },
      {
        source: 'docs/handbook/README.md',
        route: 'handbook/',
        title: 'The event handbook',
        summary: 'Find the right guide for your role.',
      },
    ],
  },
  {
    id: 'organize',
    title: 'Run your event',
    summary: 'Prepare your site, keep the program current, and help your attendees.',
    pages: [
      {
        source: 'docs/handbook/for-event-staff.md',
        route: 'handbook/for-event-staff/',
        title: 'For event staff',
        summary: 'The daily work: pages, speakers, attendees, and event updates.',
      },
      {
        source: 'docs/ADMIN_GUIDE.md',
        route: 'admin-guide/',
        title: 'Admin guide',
        summary: 'Edit pages, manage registration and tickets, send email, and choose your site branding.',
      },
      {
        source: 'docs/operator/admin-sessions.md',
        route: 'admin-sessions/',
        title: 'Manage your sessions',
        summary: 'Create, edit, preview, and publish the sessions in your program.',
      },
    ],
  },
  {
    id: 'attend',
    title: 'Attend an event',
    summary: 'Find your way around an event site and make the program your own.',
    pages: [
      {
        source: 'docs/handbook/for-attendees.md',
        route: 'handbook/for-attendees/',
        title: 'For attendees',
        summary: 'Sign in, save sessions, find materials, and update your profile.',
      },
    ],
  },
  {
    id: 'help',
    title: 'Get help',
    summary: 'Find an answer or reach the right person.',
    pages: [
      {
        source: 'docs/handbook/faq.md',
        route: 'handbook/faq/',
        title: 'Frequently asked questions',
        summary: 'Answers about sign-in, event features, demos, and hosting.',
      },
      {
        source: 'docs/handbook/getting-help.md',
        route: 'handbook/getting-help/',
        title: 'Getting help',
        summary: 'Where to ask a question or report a problem.',
      },
      {
        source: 'docs/handbook/glossary.md',
        route: 'handbook/glossary/',
        title: 'Glossary',
        summary: 'The words you will see in your event site and these guides.',
      },
      {
        source: 'SUPPORT.md',
        route: 'support/',
        title: 'Support',
        summary: 'Support contacts and what to include when you ask for help.',
      },
      {
        source: 'SECURITY.md',
        route: 'security/',
        title: 'Report a security concern',
        summary: 'How to report a vulnerability privately.',
      },
      {
        source: 'CODE_OF_CONDUCT.md',
        route: 'code-of-conduct/',
        title: 'Code of conduct',
        summary: 'The behavior expected in project spaces and how to report a concern.',
      },
    ],
  },
]);

// These routes once rendered full engineering or operator records. Keep
// bookmarks useful without duplicating those records on the marketing site.
const LEGACY_PAGES = Object.freeze([
  { source: 'docs/operator/stripe-ticketing.md', route: 'stripe-ticketing/', title: 'Stripe ticketing launch and support' },
  { source: 'docs/operator/archive-handoff.md', route: 'archive-handoff/', title: 'Archive and hand off a past event' },
  { source: 'docs/operator/webmcp-diagnostics.md', route: 'webmcp-diagnostics/', title: 'Browser diagnostics' },
  { source: 'docs/design-reference.md', route: 'design-reference/', title: 'Site design reference' },
  { source: 'docs/CLIENT_ONBOARDING.md', route: 'client-onboarding/', title: 'Client onboarding runbook' },
  { source: 'docs/DEPLOY_RUNBOOK.md', route: 'deploy-runbook/', title: 'Deploy runbook' },
  { source: 'docs/POSTMARK_PROVISIONING.md', route: 'postmark-provisioning/', title: 'Postmark provisioning' },
  { source: 'docs/EVENTBRITE_VERIFICATION.md', route: 'eventbrite-verification/', title: 'Eventbrite verification' },
  { source: 'docs/NPM_NAME_CLAIM.md', route: 'npm-name-claim/', title: 'npm name claim' },
  { source: 'CONTRIBUTING.md', route: 'contributing/', title: 'Contributing to Event Runner' },
  { source: 'GOVERNANCE.md', route: 'governance/', title: 'Project governance' },
  { source: 'RELEASING.md', route: 'releasing/', title: 'Release procedures' },
  { source: 'docs/interface-guidelines.md', route: 'interface-guidelines/', title: 'Interface guidelines' },
  { source: 'docs/adr/0001-event-platform-v1.md', route: 'decisions/0001-event-platform-v1/', title: 'ADR 0001: Event platform v1' },
  { source: 'docs/adr/0003-optional-google-calendar-sync.md', route: 'decisions/0003-optional-google-calendar-sync/', title: 'ADR 0003: Optional Google Calendar sync' },
  { source: 'docs/ROADMAP.md', route: 'roadmap/', title: 'Development roadmap' },
  { source: 'CHANGELOG.md', route: 'changelog/', title: 'Release changelog' },
]);

/**
 * Every page in reading order, each carrying its section and neighbours.
 *
 * @returns {Array<object>}
 */
function pagesInOrder() {
  const pages = [];
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      pages.push({ ...page, section });
    }
  }
  return pages.map((page, index) => ({
    ...page,
    previous: index > 0 ? pages[index - 1] : null,
    next: index < pages.length - 1 ? pages[index + 1] : null,
  }));
}

/**
 * Source path to route, for rewriting relative Markdown links.
 *
 * @returns {Map<string, string>}
 */
/**
 * Published routes for user guides only. Engineering links stay on GitHub.
 *
 * @param {string} [docsBase] the site's `docsBase`; the configured site's by default
 * @returns {Map<string, string>}
 */
function routesBySource(docsBase = pagesSite().docsBase) {
  return new Map(pagesInOrder().map((page) => [page.source, `${docsBase}${page.route}`]));
}

module.exports = {
  LEGACY_PAGES,
  REPO_BLOB,
  REPO_URL,
  SECTIONS,
  pagesInOrder,
  routesBySource,
};
