// cta: a prominent action link (BLOCK_TYPES.cta). An in-app route renders
// through the router's own <Link> — not a plain <a> — for the same reason
// LinkGroupBlock does: the public click-through demo runs under HashRouter
// (main.jsx, GitHub Pages serves no rewrite rules), where a raw
// href="/schedule" reloads the static shell at a path Pages does not
// serve rather than navigating within the app. Anything else renders as
// <a>, styled as the primary button; external links open a new tab with
// the opener relationship severed, and every anchor carries rel="noreferrer"
// regardless, so a same-tab link never leaks a referrer either.
//
// url is CMS-authored data (the published collection is world-readable and
// unvalidated server-side beyond reserved-key checks), so it goes through
// the same href allowlist as richtext links before it ever reaches the DOM.
//
// The shape is the site's one filled action, so it reads that class string
// from controlClasses.js rather than restating it. Restating it is exactly
// how the drift that module's header describes got started.
import { Link } from 'react-router-dom';
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { isCanonicalPagePath } from 'shared/routing';
import { primaryActionClass } from '../controlClasses.js';

export default function CtaBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
  if (isCanonicalPagePath(block.url)) {
    return (
      <Link to={block.url} className={primaryActionClass}>
        {block.label}
      </Link>
    );
  }
  return (
    <a
      href={block.url}
      rel="noreferrer"
      {...(block.external ? { target: '_blank' } : {})}
      className={primaryActionClass}
    >
      {block.label}
    </a>
  );
}
