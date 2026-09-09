// What a `cmsPages` document says about itself, read the same way in every
// runtime that reads one: the web app, the Cloud Functions, and the build
// scripts.
//
// A page document is read in places that have no import path between them —
// apps/web, functions/, and scripts/ — so every question asked of one has
// historically been answered two or three times over, in two or three
// slightly different ways. This module holds the answers more than one of
// them needs.

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
 * @param {unknown} page a cmsPages document
 * @returns {string} the heading, or '' when the page names itself nothing
 */
function pageHeading(page) {
  if (!page || typeof page !== 'object') return '';
  if (isNonEmptyString(page.title)) return page.title.trim();
  return isNonEmptyString(page.label) ? page.label.trim() : '';
}

module.exports = {
  pageHeading,
};
