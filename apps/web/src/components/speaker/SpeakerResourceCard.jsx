// The speaker dashboard resources (issue #215).
//
// The two event pages supply their own labels and paths. An uploaded venue map
// uses its seeded section or configured alt text; the existing area map uses
// its own seeded section. The slide template supplies both values through
// config/event. A missing, hidden, or unsafe resource is omitted, and an empty
// set draws nothing.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isCanonicalPagePath } from 'shared/routing';
import { safeUrlHref } from 'shared/urlSafety';
import { resolveVenueMap, VENUE_MAP_SECTION_ID } from 'shared/venue';
import { useContent } from '../../contexts/ContentContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { openStreetMapCoordinates } from '../AreaMap.jsx';
import ExternalLink from '../ExternalLink.jsx';
import { useVenueMapImage } from '../VenueMap.jsx';

const PAGE_IDS = Object.freeze(['guidelines', 'travel']);
const AREA_MAP_SECTION_ID = 'travel_local';
const linkClass =
  'flex h-full rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-sm font-medium text-text-primary hover:underline';

function pageResource(page) {
  if (!page || !isCanonicalPagePath(page.path)) return null;
  if (typeof page.label !== 'string' || !page.label.trim()) return null;
  return { key: `page:${page.id}`, label: page.label.trim(), to: page.path };
}

export function buildSpeakerResources({ eventConfig, features, getPublicPage, venueMap }) {
  if (typeof getPublicPage !== 'function') return [];

  const pages = PAGE_IDS.map((id) => pageResource(getPublicPage(id, features))).filter(Boolean);
  const travel = getPublicPage('travel', features);
  const mapSection = Array.isArray(travel?.sections)
    ? travel.sections.find((section) => section?.id === VENUE_MAP_SECTION_ID)
    : null;
  const mapLabel = typeof mapSection?.label === 'string' && mapSection.label.trim()
    ? mapSection.label.trim()
    : venueMap?.alt;
  if (
    venueMap
    && isCanonicalPagePath(travel?.path)
    && mapLabel
  ) {
    pages.push({
      key: 'venue-map',
      label: mapLabel,
      to: { pathname: travel.path, hash: `#section-${VENUE_MAP_SECTION_ID}` },
    });
  } else {
    const areaSection = Array.isArray(travel?.sections)
      ? travel.sections.find((section) => section?.id === AREA_MAP_SECTION_ID)
      : null;
    if (
      openStreetMapCoordinates(eventConfig?.venue?.mapUrl)
      && isCanonicalPagePath(travel?.path)
      && typeof areaSection?.label === 'string'
      && areaSection.label.trim()
    ) {
      pages.push({
        key: 'venue-map',
        label: areaSection.label.trim(),
        to: { pathname: travel.path, hash: `#section-${AREA_MAP_SECTION_ID}` },
      });
    }
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
  const venueMap = resolveVenueMap(eventConfig);
  const { src: mapSrc, onError: onMapError } = useVenueMapImage(venueMap) ?? {};
  const [loadedMapSrc, setLoadedMapSrc] = useState(null);

  // ContentPage removes the map section when its image fails. Verify the
  // same image before offering a link to that section.
  useEffect(() => {
    setLoadedMapSrc(null);
    if (!mapSrc) return undefined;
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setLoadedMapSrc(mapSrc); };
    image.onerror = () => { if (active) onMapError(); };
    image.src = mapSrc;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [mapSrc, onMapError]);

  const resources = buildSpeakerResources({
    eventConfig,
    features,
    getPublicPage,
    venueMap: mapSrc && loadedMapSrc === mapSrc ? venueMap : null,
  });

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
