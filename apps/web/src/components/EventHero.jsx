import WayfindingIcon from './editorial/WayfindingIcon.jsx';
import { focalPosition } from './LeadImage.jsx';
import { isSafeHref } from '../lib/sanitizeHtml.js';

// One live content contract; each preset composes its own artwork and marks.
// Home owns the h1; the schedule uses a paragraph before its own heading.
export default function EventHero({ name, dates, place, tagline, image, nameAs: Name = 'p', nameId, children }) {
  const alt = typeof image?.alt === 'string' ? image.alt.trim() : '';
  const src = image?.url && isSafeHref(image.url) && alt ? image.url : null;
  const caption = typeof image?.caption === 'string' ? image.caption.trim() : '';
  return (
    <div className={`event-hero${src ? ' event-hero--illustrated' : ''}`}>
      {src ? <div className="event-hero__veil" aria-hidden="true" /> : null}
      <div className="event-hero__copy">
        {name ? <Name id={nameId} className="event-hero__title font-heading">{name}</Name> : null}
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
      {src ? <figure className="event-hero__figure">
        <div className="event-hero__media">
          <img className="event-hero__art" src={src} alt={alt} style={{ objectPosition: focalPosition(image) }} fetchpriority="high" />
      {src && image.demoTransitSign ? (
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
        </div>
        {caption ? <figcaption className="event-hero__caption">{caption}</figcaption> : null}
      </figure> : null}
    </div>
  );
}
