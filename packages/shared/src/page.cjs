// What a `cmsPages` document says about itself, read the same way in every
// runtime that reads one: the web app, the Cloud Functions, and the build
// scripts.
//
// A page document is read in places that have no import path between them —
// apps/web, functions/, and scripts/ — so every question asked of one has
// historically been answered two or three times over, in two or three
// slightly different ways. This module holds the answers more than one of
// them needs.

const { SYSTEM_PAGE_ROUTES } = require('./routing.cjs');

/** @param {unknown} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * The name a READER sees for a page: its `<h1>`, its browser tab, and the
 * title a link unfurler prints.
 *
 * `label` is the NAVIGATION name and it is deliberately short — a header
 * carrying "Frequently asked questions", "Code of conduct", and "Terms of
 * service" wraps to a second row on a phone and crowds the footer's page
 * list. `title` is the page's full name, set only where the short label
 * would read oddly as a heading. Most pages state no `title` at all, and
 * for those the label IS the heading: one name, written once.
 *
 * A SYSTEM PAGE NAMES ITSELF IN CODE, SO ITS DOCUMENT DOES NOT.
 *
 * A content page's `<h1>` is drawn from this function (ContentPage.jsx), so
 * a stored title moves the heading, the tab, and the link card together. A
 * system page's heading is not: Schedule.jsx writes "Schedule" into its own
 * `<h1>`, the home page draws its hero title, and no document reaches
 * either. Honouring a title there would rename the tab and the unfurled
 * card and leave the heading where it was — one page under two names, which
 * is the disagreement this module exists to prevent. So a system page is
 * headed by its `label`, the name its route was built to show, and the
 * editor no longer offers the field for one (AdminPageEditor.jsx). Documents
 * written while it did, or written straight into Firestore, still carry a
 * title; this is where that title stops.
 *
 * @param {unknown} page a cmsPages document
 * @returns {string} the heading, or '' when the page names itself nothing
 */
function pageHeading(page) {
  if (!page || typeof page !== 'object') return '';
  if (page.systemPage !== true && isNonEmptyString(page.title)) return page.title.trim();
  return isNonEmptyString(page.label) ? page.label.trim() : '';
}

/**
 * The `config/features` key a page's own route checks before it renders
 * anything, or null for a page no flag gates.
 *
 * Read off the page's ID, which is its identity: a system page's `path` is
 * a copy of a fact that lives in App.jsx and a copy can drift, while the
 * document id is the one thing about it nothing in the editor can change.
 *
 * @param {unknown} page a cmsPages document
 * @returns {string|null}
 */
function pageFeatureGate(page) {
  const id = page && typeof page === 'object' ? page.id : null;
  if (typeof id !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(SYSTEM_PAGE_ROUTES, id)) return null;
  return SYSTEM_PAGE_ROUTES[id].feature;
}

/**
 * Whether a page document is one the public site publishes: it is visible,
 * and whatever feature gates its route is on.
 *
 * ONE PREDICATE, BECAUSE THERE IS ONE QUESTION. Three surfaces answer it —
 * the header navigation (apps/web/src/lib/siteNavigation.js), the sitemap
 * and robots file (scripts/lib/site-manifest.cjs), and the per-route
 * metadata the server writes for a link unfurler (functions/src/public/
 * og.cjs) — and three copies of a rule are three chances to disagree about
 * which pages a stranger can see. A page listed in a sitemap but missing
 * from the navigation, or described in a card but 404ing when opened, is
 * that disagreement showing.
 *
 * TWO GATES, NOT ONE. `visible` is the editor's own answer and it covers
 * every page. A system page is gated again on the flag its route already
 * checks for itself, because the seed ships every system page visible while
 * `features.updates` is off by default — visibility alone would offer a
 * link to a route that renders "not available".
 *
 * `visible` IS READ STRICTLY `=== true`. A document with the field merely
 * absent — mid-write, hand-written straight into Firestore, or older than
 * the field — must not read as published. The server side of this runs on
 * the Admin SDK, which bypasses firestore.rules, so nothing else is
 * standing behind this check there.
 *
 * This is the whole public test for a page and nothing more. A surface with
 * a further question of its own asks it separately: the sitemap also drops
 * a route that renders a sign-in prompt to a signed-out visitor, and the
 * navigation also drops a page whose stored path could not become a link.
 *
 * @param {unknown} page a cmsPages document
 * @param {object|null|undefined} features config/features
 * @returns {boolean}
 */
function isPublicPage(page, features) {
  if (!page || typeof page !== 'object') return false;
  if (page.visible !== true) return false;
  const gate = pageFeatureGate(page);
  return gate === null || features?.[gate] === true;
}

module.exports = {
  pageHeading,
  pageFeatureGate,
  isPublicPage,
};
