// The home page's `footer` section, drawn in the site footer on every page.
//
// The seed describes the section as "Grouped links rendered in the page
// footer" (scripts/lib/seed.cjs), and an operator edits it under the home
// page in Content. The footer never drew it; the home body did, under a
// "Footer links" heading (launch rehearsal, v1280-home.png). Now the home
// body leaves it out (Home.jsx) and this draws it here.
//
// The section belongs to the home page document, so it is drawn only while
// that document states it: a deleted section draws nothing, even though its
// blocks stay in cmsContent. Blocks follow the same reader rules as
// LinkGroupBlock: an unsafe href is dropped, an in-site path renders through
// the router's <Link> (the demo runs under HashRouter), and a link to a
// section that is off is not drawn (lib/linkTargets.js).
//
// Each group's name labels its own list. It is a label, not a heading, so
// the footer adds nothing to the page's heading outline.
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { isCanonicalPagePath } from 'shared/routing';
import { isSafeHref } from '../lib/sanitizeHtml.js';
import { withoutSwitchedOffLinks } from '../lib/linkTargets.js';

/** The id of the home page section this component draws. */
export const FOOTER_SECTION_ID = 'footer';

/**
 * The drawable links of the footer section, grouped by `group` in reading
 * order. Empty when the home page states no footer section.
 *
 * @param {{ homePage: object|null, blocks: object[], features: object|null }} args
 * @returns {Array<[string, object[]]>}
 */
export function footerLinkGroups({ homePage, blocks, features }) {
  const stated = (homePage?.sections ?? []).some((section) => section?.id === FOOTER_SECTION_ID);
  if (!stated) return [];
  const groups = new Map();
  for (const block of withoutSwitchedOffLinks(blocks, features)) {
    if (block?.blockType !== 'link_group') continue;
    if (typeof block.label !== 'string' || !block.label.trim()) continue;
    if (!block.url || !isSafeHref(block.url)) continue;
    const name = typeof block.group === 'string' ? block.group.trim() : '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(block);
  }
  return [...groups.entries()];
}

function FooterGroup({ name, links, linkClass }) {
  const labelId = useId();
  return (
    <div>
      {name ? (
        <p id={labelId} className="font-semibold text-text-primary">
          {name}
        </p>
      ) : null}
      <ul {...(name ? { 'aria-labelledby': labelId } : null)}>
        {links.map((block) => (
          <li key={block.id ?? `${block.section}__${block.field}`}>
            {isCanonicalPagePath(block.url) ? (
              <Link to={block.url} className={linkClass}>
                {block.label}
              </Link>
            ) : (
              <a href={block.url} rel="noreferrer" className={linkClass}>
                {block.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {{
 *   label: string,                  the section's own label, naming the landmark
 *   groups: Array<[string, object[]]>,
 *   linkClass: string,              the footer's one link treatment
 * }} props
 */
export default function FooterLinkGroups({ label, groups, linkClass }) {
  if (groups.length === 0) return null;
  return (
    <nav aria-label={label} className="mt-md">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        {groups.map(([name, links]) => (
          <FooterGroup key={name || 'ungrouped'} name={name} links={links} linkClass={linkClass} />
        ))}
      </div>
    </nav>
  );
}
