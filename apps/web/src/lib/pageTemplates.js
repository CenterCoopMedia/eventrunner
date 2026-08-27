// Page templates: the operator's vocabulary for how a page is shaped.
//
// WHY THIS EXISTS. The layout system underneath is a design system —
// `header`, `arrangement`, `density`, one select each. An operator opening
// the page editor was being asked to assemble a page out of design-system
// parts, in the design system's own words, with no way to know which
// combinations the house had actually thought about. Three selects is
// twelve combinations; the house has opinions about six of them and no
// opinion at all about "compact nameplate, grid, loose".
//
// So the operator picks a TASK — "this is a long read", "this is a
// directory with an introduction" — and the template resolves to a bundle
// of the layout values that task wants. The layout object is unchanged as
// the storage format: a template is a named, validated set of the same
// values the system already stored, not a new shape to render.
//
// WHAT THE PAGE STORES. `template` records which task was chosen and
// `layout` carries the values it set. Both are stored because they answer
// different questions: `template` is what the operator meant, and `layout`
// is what renders. A page that predates templates carries no `template`,
// which is not a gap — it is the fact that nobody chose one, and
// `templateOf` reports it honestly as `null` rather than guessing.
//
// NAVIGATION IS NOT HERE. Where the navigation sits is a property of the
// SITE, not of one page: a reader who meets a top nav on the home page and
// a side rail on the schedule has lost the shell that told them where they
// are. It moved to config/theme (shared/theme resolveNavPlacement), which
// is where the rest of the site's structural choices live.

/** The six tasks, in the order the editor offers them. */
export const PAGE_TEMPLATE_IDS = Object.freeze([
  'standard',
  'feature-first',
  'directory-intro',
  'long-read',
  'schedule',
  'landing',
]);

/**
 * What each template says, in the layout system's own values.
 *
 * Every template states all three: a template's whole job is to answer the
 * questions so the operator does not have to, and a template that left one
 * unanswered would leave the page following the preset for that one value
 * while stating the other two — which is exactly the half-configured state
 * templates exist to prevent.
 */
export const PAGE_TEMPLATES = Object.freeze({
  standard: Object.freeze({
    label: 'Standard page',
    description:
      'The ordinary page: a running header, one column, and normal spacing. Start here.',
    layout: Object.freeze({
      header: 'nameplate-compact',
      arrangement: 'list',
      density: 'comfortable',
    }),
  }),
  'feature-first': Object.freeze({
    label: 'Feature first',
    description:
      'The page opens on its main content under the full masthead. For a page whose subject is the first thing to see.',
    layout: Object.freeze({
      header: 'nameplate',
      arrangement: 'list',
      density: 'comfortable',
    }),
  }),
  'directory-intro': Object.freeze({
    label: 'Directory with introduction',
    description:
      'A few words at the top, then the entries in columns. For speakers, sponsors, and anything else that is a list of people or organizations.',
    layout: Object.freeze({
      header: 'nameplate-compact',
      arrangement: 'grid',
      density: 'comfortable',
    }),
  }),
  'long-read': Object.freeze({
    label: 'Long read',
    description:
      'One column with air between things, for a page that is mostly text and meant to be read straight through.',
    layout: Object.freeze({
      header: 'nameplate-compact',
      arrangement: 'list',
      density: 'loose',
    }),
  }),
  schedule: Object.freeze({
    label: 'Schedule',
    description:
      'Dense and time-led, so a long day fits on one screen. For the programme and anything else read against a clock.',
    layout: Object.freeze({
      header: 'nameplate-compact',
      arrangement: 'list',
      density: 'tight',
    }),
  }),
  landing: Object.freeze({
    label: 'Landing page',
    description:
      'The full masthead over items in columns. For a front page or a section opener.',
    layout: Object.freeze({
      header: 'nameplate',
      arrangement: 'grid',
      density: 'comfortable',
    }),
  }),
});

/** @param {unknown} id @returns {boolean} */
export function isKnownTemplate(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PAGE_TEMPLATES, id);
}

/**
 * The layout bundle a template sets, as a fresh object the caller may keep.
 *
 * @param {unknown} id
 * @returns {{ header: string, arrangement: string, density: string } | null}
 */
export function templateLayout(id) {
  return isKnownTemplate(id) ? { ...PAGE_TEMPLATES[id].layout } : null;
}

/**
 * The template a document states, or `null`.
 *
 * Deliberately NOT inferred from the layout. A page whose values happen to
 * match "Long read" has not chosen Long read — it has three values that
 * coincide, and reporting a choice nobody made would make the editor lie
 * about the page in front of it. Absence is reported as absence, the same
 * rule statedPageLayout follows for the variants themselves.
 *
 * @param {object|null} doc a cmsPages document
 * @returns {string|null}
 */
export function templateOf(doc) {
  return isKnownTemplate(doc?.template) ? doc.template : null;
}

/** The words for one template, for a control that has to name it. */
export function templateLabel(id) {
  return isKnownTemplate(id) ? PAGE_TEMPLATES[id].label : id;
}
