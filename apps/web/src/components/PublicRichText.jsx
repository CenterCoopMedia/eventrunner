import { internalRoutePath } from 'shared/languageUrls';
import { joinEventPath } from 'shared/config/publicPath';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { sanitizeHtml } from '../lib/sanitizeHtml.js';
import './PublicRichText.css';

export default function PublicRichText({ value, ...props }) {
  const { localize, rootHref, navigate } = usePublicLanguage();
  const html = sanitizeHtml(value, rootHref && ((href) => {
    if (!internalRoutePath(href)) return null;
    const to = localize(href);
    return { to, href: joinEventPath(rootHref, to) };
  }));
  if (!html) return null;

  function followRoute(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[data-public-route]');
    if (!link) return;
    event.preventDefault();
    navigate(link.dataset.publicRoute);
  }

  return <div {...props} onClick={navigate ? followRoute : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}
