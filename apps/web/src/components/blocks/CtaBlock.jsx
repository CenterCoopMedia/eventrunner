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
import { PublicLink as Link } from '../PublicLink.jsx';
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { internalRoutePath } from 'shared/contentLanguages';
import { primaryActionClass } from '../controlClasses.js';
import ExternalLink from '../ExternalLink.jsx';

export default function CtaBlock({ block }) {
  if (!block?.url || !block?.label || !isSafeHref(block.url)) return null;
  if (internalRoutePath(block.url)) {
    return (
      <Link to={block.url} className={primaryActionClass} lang={block.publicLanguage}>
        {block.label}
      </Link>
    );
  }
  // Only the external branch opens a tab, so only that branch carries the
  // marker. A same-tab link that claimed to open one would be a lie in a
  // string nobody can see (components/ExternalLink.jsx).
  if (block.external) {
    return (
      <ExternalLink href={block.url} className={primaryActionClass} lang={block.publicLanguage}>
        {block.label}
      </ExternalLink>
    );
  }
  return (
    <a href={block.url} rel="noreferrer" className={primaryActionClass} lang={block.publicLanguage}>
      {block.label}
    </a>
  );
}
