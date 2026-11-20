import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { buildNavItems } from '../lib/siteNavigation.js';
import { PublicLink } from './PublicLink.jsx';

export default function FooterPageLinks({ pages, defaultItems, linkClass }) {
  const { eventConfig, features } = useEventConfig();
  const { text } = usePublicLanguage();
  const { heading, pageIds } = eventConfig?.footerPageGroup ?? {};
  let items = defaultItems;
  if (Array.isArray(pageIds)) {
    const orderById = new Map(pageIds.map((id, index) => [id, index]));
    const selectedPages = (pages ?? [])
      .filter((page) => orderById.has(page?.id))
      .map((page) => ({ ...page, order: orderById.get(page.id) }));
    items = buildNavItems(selectedPages, features);
  }
  const pageItems = items.filter((item) => !item.custom);
  if (pageItems.length === 0) return null;
  const label = (typeof heading === 'string' && heading.trim()) || text('Site pages', 'Páginas del sitio');

  return (
    <nav aria-label={label} className="mt-sm">
      <p className="break-words font-semibold text-text-primary">{label}</p>
      <ul className="footer-links">
        {pageItems.map((item) => (
          <li key={item.to}>
            <PublicLink to={item.to} className={linkClass} lang={item.language}>{item.label}</PublicLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
