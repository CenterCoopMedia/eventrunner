// Sponsors page — the public directory of supporting organizations.
// Feature-gated by config/features.sponsors — the nav link already hides
// when the feature is off, but the route itself must gate too, since direct
// navigation bypasses the nav (matches the Schedule.jsx pattern).
//
// A TIERED LOGO WALL (design brief §5.1; this review).
//
// The other three directories are lists of people or of posts. This one is
// not a list at all — it is an acknowledgement, and the thing being
// acknowledged is degree. An operator agreed that one supporter is a
// presenting sponsor and another is a partner, and a page that renders both
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
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import AssetImage from '../components/media/AssetImage.jsx';
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

export default function Sponsors() {
  const { features } = useEventConfig();
  const { organizationsData } = useContent();
  const visible = organizationsData.filter((o) => o.visible);

  if (!features.sponsors) {
    return (
      <EmptyState
        title="This event doesn’t have public sponsors"
        description="Everything else about the event is on the home page."
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  const groups = groupByTier(visible);

  return (
    <SystemPage pageId="sponsors">
      {({ arrangement }) => (
        <>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">Sponsors</h1>
          {visible.length === 0 ? (
            <div className="mt-lg">
              <EmptyState
                title="Sponsors have not been announced yet"
                description="Supporting organizations appear here once they are published."
              />
            </div>
          ) : (
            groups.map((group, rank) => (
              <section key={group.tier} className="mt-xl" aria-labelledby={`tier-${rank}`}>
                {/* The tier as a standing head: a folio on a rule, beside
                    it and never stacked above the marks (brief §2.4). */}
                <SectionHead
                  variant="folio"
                  level={2}
                  id={`tier-${rank}`}
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
                    <li key={org.id} className="max-w-full">
                      {/* Decorative: the organization's name is directly
                          under the mark and links to the same place, so
                          alt text here would say it twice. */}
                      <div className="logo-wall__mark">
                        {org.logoPath ? (
                          <AssetImage path={org.logoPath} alt="" className="" />
                        ) : null}
                      </div>
                      <h3 className="mt-2xs font-heading text-h3 font-semibold text-text-primary">
                        <SponsorName org={org} />
                      </h3>
                      {/* `arrangement` (brief §6.1) decides how much of a
                          supporter the wall says: `list` is the reading
                          wall, with each organization's description under
                          its mark; `grid` is the acknowledgement wall,
                          marks and names only. Both are the same wall and
                          the same data — the descriptions are on each
                          sponsor's own site, one link away. */}
                      {arrangement === 'grid' || !org.description ? null : (
                        <p
                          className="mt-2xs max-w-prose text-body text-text-secondary"
                          style={{ textWrap: 'pretty' }}
                        >
                          {org.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </SystemPage>
  );
}
