import { googleMapsEmbedUrl, safeUrlHref } from 'shared/urlSafety';
import { isStarterContent } from 'shared/seed';
import { venueAddress } from 'shared/venue';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { usePublicLanguage } from '../../contexts/PublicLanguageContext.jsx';

function googleMapsSearch(query) {
  const url = new URL('https://www.google.com/maps/search/');
  url.search = new URLSearchParams({ api: '1', query });
  return url.href;
}

function MapFrame({ src, label, address, href, publicLanguage, preview }) {
  const { language, text } = usePublicLanguage();
  const mapLink = new URL(href);
  const isGoogle = mapLink.hostname === 'maps.app.goo.gl'
    || mapLink.hostname === 'maps.google.com'
    || (mapLink.hostname === 'www.google.com' && /^\/maps(?:\/|$)/.test(mapLink.pathname))
    || (mapLink.hostname === 'goo.gl' && mapLink.pathname.startsWith('/maps/'));
  return (
    <div
      lang={publicLanguage}
      role={preview ? 'region' : undefined}
      aria-label={preview ? 'Map preview' : undefined}
      className={`w-full max-w-prose space-y-xs ${preview ? 'mt-md' : ''}`}
    >
      <iframe
        src={src}
        title={label}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin"
        className="block aspect-[4/3] min-h-[200px] w-full border-0"
      />
      {address ? <p className="text-body text-text-primary">{address}</p> : null}
      <a href={href} rel="noreferrer" lang={language} className="text-link underline">
        {isGoogle ? text('Open in Google Maps', 'Abrir en Google Maps') : text('Open venue map', 'Abrir el mapa del recinto')}
      </a>
    </div>
  );
}

function EventVenueMap({ block, label, address, preview }) {
  const { eventConfig } = useEventConfig();
  const venue = eventConfig?.venue;
  const name = typeof venue?.name === 'string' ? venue.name.trim() : '';
  const street = typeof venue?.addressLine1 === 'string' ? venue.addressLine1.trim() : '';
  if (!name || !street) {
    return preview ? (
      <p className="mt-md text-admin-sm text-admin-state-caution">
        Add the venue name and street address in Event settings to preview this map.
      </p>
    ) : null;
  }
  const savedAddress = venueAddress(venue);
  const query = `${name}, ${savedAddress}`;
  const src = new URL('https://www.google.com/maps');
  src.search = new URLSearchParams({ q: query, output: 'embed' });
  return (
    <MapFrame
      src={src.href}
      label={label}
      address={address || savedAddress}
      href={safeUrlHref(venue.mapUrl) || googleMapsSearch(query)}
      publicLanguage={block.publicLanguage}
      preview={preview}
    />
  );
}

export default function MapBlock({ block, preview = false }) {
  const label = typeof block?.label === 'string' ? block.label.trim() : '';
  const address = typeof block?.address === 'string' ? block.address.trim() : '';
  if (!label || isStarterContent({ label, address })) return null;
  if (block.useEventVenue === true) {
    return <EventVenueMap block={block} label={label} address={address} preview={preview} />;
  }
  const src = googleMapsEmbedUrl(block.embedUrl);
  if (!src || src !== block.embedUrl || isStarterContent({ embedUrl: src })) return null;
  return (
    <MapFrame
      src={src}
      label={label}
      address={address}
      href={googleMapsSearch(address || label)}
      publicLanguage={block.publicLanguage}
      preview={preview}
    />
  );
}
