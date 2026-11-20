import { googleMapsEmbedUrl } from 'shared/urlSafety';
import { usePublicLanguage } from '../../contexts/PublicLanguageContext.jsx';

export default function MapBlock({ block, preview = false }) {
  const { language, text } = usePublicLanguage();
  const src = googleMapsEmbedUrl(block?.embedUrl);
  const label = typeof block?.label === 'string' ? block.label.trim() : '';
  if (!src || src !== block.embedUrl || !label) return null;

  const address = typeof block.address === 'string' ? block.address.trim() : '';
  const mapsHref = new URL('https://www.google.com/maps/search/');
  mapsHref.search = new URLSearchParams({ api: '1', query: address || label });

  return (
    <div
      lang={block.publicLanguage}
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
      <a href={mapsHref.href} rel="noreferrer" lang={language} className="text-link underline">
        {text('Open in Google Maps', 'Abrir en Google Maps')}
      </a>
    </div>
  );
}
