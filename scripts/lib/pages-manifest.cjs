'use strict';

/**
 * The documentation site's map (#108).
 *
 * Every published page is listed here explicitly. One source Markdown file
 * maps to exactly one stable route, so a document cannot appear twice, and
 * nothing reaches the site by being dropped into a directory. Historical
 * planning records (`docs/plans/**`) are deliberately absent: they stay
 * readable on GitHub, but they are not public navigation.
 *
 * `route` is relative to `/eventrunner/docs/`. Order inside a section is
 * reading order, and it drives the previous/next links.
 */

const SITE_ORIGIN = 'https://centercoopmedia.github.io';
const SITE_BASE = '/eventrunner/';
const DOCS_BASE = `${SITE_BASE}docs/`;
const REPO_URL = 'https://github.com/CenterCoopMedia/eventrunner';
const REPO_BLOB = `${REPO_URL}/blob/main/`;

const SECTIONS = Object.freeze([
  {
    id: 'start',
    title: 'Start here',
    summary: 'What Event Runner is, and the plain-language handbook for the people using a site.',
    pages: [
      {
        source: 'README.md',
        route: 'overview/',
        title: 'Overview',
        summary: 'What the product is, what v1 includes, and how a deployment is run.',
      },
      {
        source: 'docs/handbook/README.md',
        route: 'handbook/',
        title: 'Handbook',
        summary: 'The non-technical guide, split by who you are.',
      },
      {
        source: 'docs/handbook/for-clients.md',
        route: 'handbook/for-clients/',
        title: 'For clients',
        summary: 'What a client organization owns, and what CCM operates.',
      },
      {
        source: 'docs/handbook/for-event-staff.md',
        route: 'handbook/for-event-staff/',
        title: 'For event staff',
        summary: 'Running the site day to day from the admin panel.',
      },
      {
        source: 'docs/handbook/for-attendees.md',
        route: 'handbook/for-attendees/',
        title: 'For attendees',
        summary: 'Signing in, bookmarking sessions, and fixing a profile.',
      },
      {
        source: 'docs/handbook/faq.md',
        route: 'handbook/faq/',
        title: 'FAQ',
        summary: 'Short answers to the questions that come up most.',
      },
      {
        source: 'docs/handbook/getting-help.md',
        route: 'handbook/getting-help/',
        title: 'Getting help',
        summary: 'Which door to use for which kind of problem.',
      },
      {
        source: 'docs/handbook/glossary.md',
        route: 'handbook/glossary/',
        title: 'Glossary',
        summary: 'The words this project uses, defined once.',
      },
    ],
  },
  {
    id: 'operate',
    title: 'Operate',
    summary: 'The runbooks CCM staff follow to provision, deploy, and hand over a client event.',
    pages: [
      {
        source: 'docs/ADMIN_GUIDE.md',
        route: 'admin-guide/',
        title: 'Admin guide',
        summary: 'Every admin screen, in the order staff meet them.',
      },
      {
        source: 'docs/CLIENT_ONBOARDING.md',
        route: 'client-onboarding/',
        title: 'Client onboarding',
        summary: 'The provisioning checklist from first call to handover.',
      },
      {
        source: 'docs/DEPLOY_RUNBOOK.md',
        route: 'deploy-runbook/',
        title: 'Deploy runbook',
        summary: 'Standing up a client Firebase project and shipping to it.',
      },
      {
        source: 'docs/POSTMARK_PROVISIONING.md',
        route: 'postmark-provisioning/',
        title: 'Postmark provisioning',
        summary: 'Sender domain, message streams, and webhook cutover.',
      },
      {
        source: 'docs/EVENTBRITE_VERIFICATION.md',
        route: 'eventbrite-verification/',
        title: 'Eventbrite verification',
        summary: 'Verifying the ticketing adapter against a real Eventbrite account.',
      },
      {
        source: 'docs/NPM_NAME_CLAIM.md',
        route: 'npm-name-claim/',
        title: 'npm name claim',
        summary: 'Claiming and holding the package name.',
      },
    ],
  },
  {
    id: 'build',
    title: 'Build',
    summary: 'What contributors need before opening a pull request, and the decisions behind the code.',
    pages: [
      {
        source: 'CONTRIBUTING.md',
        route: 'contributing/',
        title: 'Contributing',
        summary: 'Setup, tests, sign-off, and the proportional CI tiers.',
      },
      {
        source: 'CODE_OF_CONDUCT.md',
        route: 'code-of-conduct/',
        title: 'Code of conduct',
        summary: 'The behavior expected in every project space, and how to report a problem.',
      },
      {
        source: 'GOVERNANCE.md',
        route: 'governance/',
        title: 'Governance',
        summary: 'Who decides what, and how a decision gets made.',
      },
      {
        source: 'RELEASING.md',
        route: 'releasing/',
        title: 'Releasing',
        summary: 'How a tagged release is cut and what it promises.',
      },
      {
        source: 'docs/interface-guidelines.md',
        route: 'interface-guidelines/',
        title: 'Interface guidelines',
        summary: 'The interface rules the web app is held to.',
      },
      {
        source: 'docs/adr/0001-event-platform-v1.md',
        route: 'decisions/0001-event-platform-v1/',
        title: 'ADR 0001: Event platform v1',
        summary: 'The v1 architecture decision record. This is the contract.',
      },
      {
        source: 'docs/ROADMAP.md',
        route: 'roadmap/',
        title: 'Roadmap',
        summary: 'The five v1 milestones and what is left.',
      },
      {
        source: 'CHANGELOG.md',
        route: 'changelog/',
        title: 'Changelog',
        summary: 'What changed, release by release.',
      },
    ],
  },
  {
    id: 'help',
    title: 'Get help',
    summary: 'Where to ask, and how to report something that should not be public.',
    pages: [
      {
        source: 'SUPPORT.md',
        route: 'support/',
        title: 'Support',
        summary: 'Where questions go, and what to expect back.',
      },
      {
        source: 'SECURITY.md',
        route: 'security/',
        title: 'Security',
        summary: 'Reporting a vulnerability privately.',
      },
    ],
  },
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
function routesBySource() {
  return new Map(pagesInOrder().map((page) => [page.source, `${DOCS_BASE}${page.route}`]));
}

module.exports = {
  DOCS_BASE,
  REPO_BLOB,
  REPO_URL,
  SECTIONS,
  SITE_BASE,
  SITE_ORIGIN,
  pagesInOrder,
  routesBySource,
};
