// link_group: a titled link within a named group (BLOCK_TYPES.link_group).
// LinkGroups groups a run by `group`; each item is one descriptive link.
//
// url is CMS-authored data (unvalidated server-side beyond reserved-key
// checks), so it goes through the same href allowlist as richtext links.
//
// An in-app route ('/schedule') renders through the router's own <Link>,
// not a plain <a>: the public click-through demo runs under HashRouter
// (main.jsx — GitHub Pages serves no rewrite rules), where a raw
// href="/schedule" reloads the static shell at a path Pages does not
// serve — a 404 — instead of navigating within the app. A real client
// deployment's rewrites hide the bug; the demo is where it surfaces.
// Anything that is not that exact shape (an external URL, mailto:, a bare
// fragment) still renders as a normal anchor, severing the opener
// relationship either way.
//
// It is an inline link in running content, not one of the four control
// shapes in controlClasses.js, so it draws the prose-link treatment the
// .rich-text anchor rule sets: accent ink, an
// underline at 40%, accent-strong on hover.
import { PublicLink as Link } from '../PublicLink.jsx';
import Folio from '../editorial/Folio.jsx';
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { internalRoutePath } from 'shared/languageUrls';

const LINK_CLASS =
  'touch-target inline-flex items-center text-body text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-strong';

export default function LinkGroupBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
  return (
    <li lang={block.publicLanguage}>
      {internalRoutePath(block.url) ? (
        <Link to={block.url} className={LINK_CLASS}>
          {block.label}
        </Link>
      ) : (
        <a href={block.url} rel="noreferrer" className={LINK_CLASS}>
          {block.label}
        </a>
      )}
    </li>
  );
}

export function LinkGroups({ blocks }) {
  const groups = new Map();
  for (const block of blocks) {
    const name = block.group ?? '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(block);
  }
  return (
    <div className="grid gap-lg sm:grid-cols-2">
      {[...groups.entries()].map(([name, links]) => (
        <div key={name || 'ungrouped'}>
          {name ? (
            <Folio as="h3" className="border-t-hairline border-t-rule-hairline pt-2xs">
              {name}
            </Folio>
          ) : null}
          <ul className="mt-xs space-y-3xs">
            {links.map((block, index) => (
              <LinkGroupBlock key={block.id ?? `${block.section}__${block.field ?? index}`} block={block} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
