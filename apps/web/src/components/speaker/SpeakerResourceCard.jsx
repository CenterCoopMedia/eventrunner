// The speaker dashboard resources (issue #215).
//
// The two event pages supply their own labels and paths. The venue-map link
// uses the seeded map section's label and anchor. The slide template supplies
// both values through config/event. A missing, hidden, or unsafe resource is
// omitted, and an empty set draws nothing.
import { Link } from 'react-router-dom';
import { isCanonicalPagePath } from 'shared/routing';
import { safeUrlHref } from 'shared/urlSafety';
import { resolveVenueMap, VENUE_MAP_SECTION_ID } from 'shared/venue';
import { useContent } from '../../contexts/ContentContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import ExternalLink from '../ExternalLink.jsx';

const PAGE_IDS = Object.freeze(['guidelines', 'travel']);
const linkClass =
  'flex h-full rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-sm font-medium text-text-primary hover:underline';

function pageResource(page) {
  if (!page || !isCanonicalPagePath(page.path)) return null;
  if (typeof page.label !== 'string' || !page.label.trim()) return null;
  return { key: `page:${page.id}`, label: page.label.trim(), to: page.path };
}

export function buildSpeakerResources({ eventConfig, features, getPublicPage }) {
  if (typeof getPublicPage !== 'function') return [];

  const pages = PAGE_IDS.map((id) => pageResource(getPublicPage(id, features))).filter(Boolean);
  const travel = getPublicPage('travel', features);
  const mapSection = Array.isArray(travel?.sections)
    ? travel.sections.find((section) => section?.id === VENUE_MAP_SECTION_ID)
    : null;
  if (
    resolveVenueMap(eventConfig)
    && isCanonicalPagePath(travel?.path)
    && typeof mapSection?.label === 'string'
    && mapSection.label.trim()
  ) {
    pages.push({
      key: 'venue-map',
      label: mapSection.label.trim(),
      to: { pathname: travel.path, hash: `#section-${VENUE_MAP_SECTION_ID}` },
    });
  }

  const slideTemplate = eventConfig?.speakerResources?.slideTemplate;
  const slideHref = safeUrlHref(slideTemplate?.url);
  if (slideHref && typeof slideTemplate?.label === 'string' && slideTemplate.label.trim()) {
    pages.push({
      key: 'slide-template',
      label: slideTemplate.label.trim(),
      href: slideHref,
    });
  }

  return pages;
}

export default function SpeakerResourceCard() {
  const { getPublicPage } = useContent();
  const { eventConfig, features } = useEventConfig();
  const resources = buildSpeakerResources({ eventConfig, features, getPublicPage });

  if (resources.length === 0) return null;

  return (
    <nav aria-label="Speaker resources" className="mt-xl">
      <ul className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
        {resources.map((resource) => (
          <li key={resource.key}>
            {resource.href ? (
              <ExternalLink href={resource.href} className={linkClass}>
                {resource.label}
              </ExternalLink>
            ) : (
              <Link to={resource.to} className={linkClass}>
                {resource.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
