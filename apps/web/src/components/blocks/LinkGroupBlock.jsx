// link_group: a titled link within a named group (BLOCK_TYPES.link_group).
// SectionBlocks groups items by `group` and renders the group heading; each
// item is one descriptive link (interface guidelines: links say where they
// go, hit areas stay comfortable).
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
// .rich-text anchor rule already sets in index.css: accent ink, an
// underline at 40%, accent-strong on hover.
import { Link } from 'react-router-dom';
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { isCanonicalPagePath } from 'shared/routing';

const LINK_CLASS =
  'touch-target inline-flex items-center text-body text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-strong';

export default function LinkGroupBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
  return (
    <li>
      {isCanonicalPagePath(block.url) ? (
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
