import { useState } from 'react';
import WayfindingIcon from './editorial/WayfindingIcon.jsx';
import { focalPosition, useSizedImageSources } from '../lib/useImageSizeSrcSet.js';
import { isSafeHref } from '../lib/sanitizeHtml.js';
import ImageFigure from './media/ImageFigure.jsx';

// One live content contract; each preset composes its own artwork and marks.
// Home owns the h1. Schedule's compact treatment supplies artwork only;
// its page introduction owns the event dateline.
export default function EventHero({
  name,
  dates,
  place,
  tagline,
  image,
  compact = false,
  nameAs: Name = 'p',
  nameId,
  logo = null,
  logoPlacement = 'off',
  children,
}) {
  // The organizer's logo above the name, or in its place (#1167). The name
  // stays in the document as the heading either way, so assistive tech and
  // search read the event name. A logo that fails leaves the name in view.
  const [failedLogo, setFailedLogo] = useState(null);
  const showLogo = Boolean(logo) && logoPlacement !== 'off' && failedLogo !== logo;
  const nameHidden = showLogo && logoPlacement === 'instead';
  const alt = typeof image?.alt === 'string' ? image.alt.trim() : '';
  const src = image?.url && isSafeHref(image.url) && alt ? image.url : null;
  // The artwork can fill the whole hero on a phone, and a style can give it
  // the full width at any size, so the slot is stated as the viewport.
  const art = useSizedImageSources(src);
  const figure = src ? <ImageFigure
    placement={image}
    assetPath={art.path}
    className="event-hero__figure"
    mediaClassName="event-hero__media"
    legacyCaptionClass="event-hero__caption"
  >
      <img className="event-hero__art" src={art.src} srcSet={art.srcSet} sizes={art.srcSet ? '100vw' : undefined} onError={art.onError} alt={alt} style={{ objectPosition: focalPosition(image), ...(art.pending ? { visibility: 'hidden' } : null) }} fetchpriority="high" />
      {image.demoTransitSign ? (
        <div className="event-hero__sign" aria-hidden="true">
          <WayfindingIcon name="transit" /><span>→</span>
        </div>
      ) : null}
      <svg className="event-hero__route" viewBox="0 0 1200 110" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path d="M-10 82H675C722 82 720 30 767 30H1210" />
        <circle cx="185" cy="82" r="9" /><circle cx="545" cy="82" r="9" /><circle cx="1040" cy="30" r="9" />
      </svg>
      <svg className="event-hero__press" viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <circle cx="50" cy="50" r="35" /><path d="M50 4V22M50 78V96M4 50H22M78 50H96M35 50H65M50 35V65" />
      </svg>
  </ImageFigure> : null;
  if (compact) return figure ? (
    <div className="event-hero event-hero--illustrated event-hero--compact">{figure}</div>
  ) : null;
  return (
    <div
      className={[
        'event-hero',
        src ? 'event-hero--illustrated' : '',
      ].filter(Boolean).join(' ')}
    >
      {src ? <div className="event-hero__veil" aria-hidden="true" /> : null}
      {figure}
      <div className="event-hero__copy">
        {showLogo ? (
          <img className="event-hero__logo mb-sm block" src={logo} alt="" onError={() => setFailedLogo(logo)} />
        ) : null}
        {name ? <Name id={nameId} className={`event-hero__title font-heading${nameHidden ? ' sr-only' : ''}`}>{name}</Name> : null}
        {dates || place ? (
          <p className="event-hero__dateline font-data">
            {dates ? <span>{dates}</span> : null}
            {dates && place ? <span aria-hidden="true">·</span> : null}
            {place ? <span>{place}</span> : null}
          </p>
        ) : null}
        {typeof tagline === 'string' && tagline.trim() ? <p className="event-hero__tagline font-body">{tagline}</p> : null}
        {children}
      </div>
    </div>
  );
}
