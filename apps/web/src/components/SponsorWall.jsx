// The tiered logo wall (design brief §5.1) — one wall, drawn the same way
// wherever it appears.
//
// It was written inside the sponsors page and now the home page shows the
// same acknowledgement (M7 issue 10), so the wall moved here whole rather
// than being copied. A second copy would be a second set of tier rules, and
// the tier rules are the whole point of the composition.
//
// THE COMPOSITION, unchanged from where it was written:
//
// The other three directories are lists of people or of posts. This one is
// not a list at all — it is an acknowledgement, and the thing being
// acknowledged is degree. An operator agreed that one supporter is a
// presenting sponsor and another is a partner, and a wall that renders both
// as identical ruled rows states the opposite of what was agreed. So the
// tier is the composition: named groups down the page, and inside each
// group a wall of marks whose SIZE carries the tier's weight.
//
// STANDING COMES FROM THE OPERATOR'S ORDER, NEVER FROM THE TIER'S NAME. The
// tier is free text — "presenting", "Gold", "Medienpartner" — and nothing
// here tries to rank those words. That would be the room-string inference
// all over again: a guess about meaning, dressed as a fact, that the
// operator never made and cannot correct. Instead the groups appear in the
// order their first member appears in the operator's own ordering (the
// `order` field the admin list sorts by), and the group's RANK in that
// sequence sets the mark size. To promote a tier, move it up the list —
// which is the control an operator already has and already understands.
//
// A mark is contained, never cropped: a sponsor's logo is their property
// and `object-fit: cover` would cut it. Every mark sits on the alternate
// ground at the house radius, which is what lets a wall of wildly
// different logo files read as one wall without any of them being boxed.
import { useContent } from '../contexts/ContentContext.jsx';
import SectionHead from './editorial/SectionHead.jsx';
import AssetImage from './media/AssetImage.jsx';
import { isSafeHref } from '../lib/sanitizeHtml.js';

/**
 * The mark size for a tier group, by its rank in the operator's ordering.
 *
 * Three steps and then a floor: past the third group the differences stop
 * being legible as differences, and a fourth smaller size would only be a
 * smaller size. Every value is the spacing scale multiplied, so a preset
 * that rescales the room rescales the wall with it.
 */
const MARK_SIZES = Object.freeze([
  'calc(var(--space-3xl) * 2)',
  'calc(var(--space-3xl) * 1.5)',
  'var(--space-3xl)',
]);

/** A tier's label, or the one heading an untiered group gets. */
function tierLabel(tier) {
  return typeof tier === 'string' && tier.trim() ? tier.trim() : 'Supporters';
}

/**
 * The organizations an operator has published, in their own order.
 *
 * One place, because both surfaces have to agree about what "published"
 * means: a wall that hid a different set from the page's own empty state
 * would say "none yet" over a wall of marks.
 *
 * @param {Array<object>} organizations the cmsOrganizations documents
 * @returns {Array<object>}
 */
export function visibleOrganizations(organizations) {
  return (Array.isArray(organizations) ? organizations : []).filter((org) => org?.visible);
}

/**
 * The visible organizations grouped by tier, groups in the order their
 * first member appears.
 *
 * Keyed on the tier's exact text: "Gold" and "gold" are two labels an
 * operator wrote differently, and folding them together would silently
 * rewrite one of them.
 *
 * @param {Array<object>} organizations already filtered and in order
 * @returns {Array<{ tier: string, members: object[] }>}
 */
export function groupByTier(organizations) {
  const groups = new Map();
  for (const org of organizations) {
    const key = tierLabel(org?.tier);
    const members = groups.get(key) ?? [];
    members.push(org);
    groups.set(key, members);
  }
  return [...groups.entries()].map(([tier, members]) => ({ tier, members }));
}

/** One organization's name, linked where the URL is one we may follow. */
function SponsorName({ org }) {
  return isSafeHref(org.url) ? (
    <a href={org.url} target="_blank" rel="noreferrer" className="hover:underline">
      {org.name}
    </a>
  ) : (
    org.name
  );
}

/**
 * @param {{
 *   organizations: object[],           // already filtered to the visible set
 *   arrangement?: 'grid' | 'list',     // the page layout's own arrangement
 *   level?: 2 | 3 | 4,                 // the heading level a tier head takes
 *   idPrefix?: string,                 // namespaces the tier head ids
 * }} props
 */
export default function SponsorWall({
  organizations,
  arrangement = 'grid',
  level = 2,
  idPrefix = 'tier',
}) {
  const groups = groupByTier(organizations);
  if (groups.length === 0) return null;
  // A name sits under its tier in the outline, never beside it: the tier
  // head is the group and the names are what is in it. So the name's level
  // follows the tier's rather than being fixed, and a wall dropped one
  // level deeper on the home page takes its names down with it.
  const NameTag = `h${Math.min(level + 1, 6)}`;

  return groups.map((group, rank) => (
    <section key={group.tier} className="mt-xl" aria-labelledby={`${idPrefix}-${rank}`}>
      {/* The tier as a standing head: a folio on a rule, beside it and
          never stacked above the marks (brief §2.4). */}
      <SectionHead
        variant="folio"
        level={level}
        id={`${idPrefix}-${rank}`}
        title={group.tier}
        folio={
          group.members.length === 1 ? '1 organization' : `${group.members.length} organizations`
        }
      />
      <ul
        className="logo-wall mt-md"
        style={{
          '--logo-wall-mark-size': MARK_SIZES[Math.min(rank, MARK_SIZES.length - 1)],
        }}
      >
        {group.members.map((org) => (
          <li key={org.id}>
            {/* Decorative: the organization's name is directly under the
                mark and links to the same place, so alt text here would
                say it twice — and a logo file that has gone missing from
                the bucket must not announce that to a visitor, who cannot
                act on it and was never asked to think about the file. The
                mark box keeps its size either way, so a missing logo is an
                empty frame in the wall rather than a hole in it. */}
            <div className="logo-wall__mark">
              {org.logoPath ? (
                <AssetImage path={org.logoPath} alt="" className="" decorative />
              ) : null}
            </div>
            {/* The name is a caption under the mark, not a headline over a
                card: the wall's own weighting is what says how much of a
                supporter this is, so the name does not have to shout it a
                second time. */}
            <NameTag className="mt-2xs font-heading text-body font-semibold text-text-primary text-pretty">
              <SponsorName org={org} />
            </NameTag>
            {/* `arrangement` (brief §6.1) decides how much of a supporter
                the wall says: `list` is the reading wall, with each
                organization's description under its mark; `grid` is the
                acknowledgement wall, marks and names only. Both are the
                same wall and the same data — the descriptions are on each
                sponsor's own site, one link away. */}
            {arrangement === 'grid' || !org.description ? null : (
              <p className="mt-2xs max-w-prose text-body text-text-secondary text-pretty">
                {org.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  ));
}

/**
 * The wall as one section of a page (M7 issue 10): the same wall, reading
 * the same published organizations, under the section's own heading.
 *
 * IT IS A SECTION LIKE ANY OTHER, drawn where the operator put it. It is
 * handed to `SystemPage`'s `renderSection`, not rendered at a fixed point
 * inside a page's core, so dragging the section in the admin moves it on
 * the page and its `slot` decides whether it sits above the core or below.
 * A section that a page draws itself but that ignores the page's own
 * ordering is a control that looks like it works and does not.
 *
 * IT RENDERS NOTHING RATHER THAN AN EMPTY ACKNOWLEDGEMENT. A heading that
 * says "Sponsors" over nothing is a promise the page cannot keep, and an
 * event that has not announced any supporters yet has nothing to say here.
 * The caller gates on `features.sponsors`; this gates on there being
 * organizations at all.
 *
 * @param {{ id: string, title: string, level?: 2 | 3, lede?: string | null }} props
 */
export function SponsorStrip({ id, title, level = 2, lede = null }) {
  const { organizationsData } = useContent();
  const visible = visibleOrganizations(organizationsData);
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby={id} className="page-section">
      <SectionHead level={level} id={id} title={title} />
      {lede ? (
        <p className="mt-sm max-w-prose text-body text-text-secondary text-pretty">{lede}</p>
      ) : null}
      {/* The acknowledgement wall: marks and names. A reader who wants the
          descriptions has the sponsors page one link away, and the home
          page is not where a directory belongs. Tier heads sit a level
          under this section's own heading. */}
      <SponsorWall organizations={visible} arrangement="grid" level={3} idPrefix={`${id}-tier`} />
    </section>
  );
}
