// Avatar — a person's picture, or their initial where there is none
// (expansion record §3.3).
//
// SQUARE ON THE BRAND RADIUS, NEVER A CIRCLE. A circular crop is a
// generic-template tell (design brief §2.4; interface guidelines, User
// interface), so the frame reads `--avatar-radius`, which defaults to the
// one radius every other shape in the system takes. The initial sits in the
// heading face on the alternate ground, and the hairline frame is an inset
// outline so a picture keeps its full size.
//
// THE STAND-IN IS DECORATIVE. Wherever an avatar is drawn the person's name
// is text beside it, so the initial is hidden from assistive technology and
// a picture carries an empty alt. A caller that draws the picture without
// the name passes its own alt.
//
// This component draws. It does not resolve: which URL a stored path turns
// into, and what happens when the object is gone, are the caller's problem
// (components/media/ProfilePhoto.jsx owns that for attendee photos).

/** The first letter of a display name, for the stand-in. */
export function initialOf(displayName) {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  return name ? Array.from(name)[0].toUpperCase() : '?';
}

const SIZE_CLASS = Object.freeze({
  sm: 'avatar--sm',
  md: 'avatar--md',
  lg: 'avatar--lg',
});

/**
 * @param {{
 *   src?: string | null,        // a resolved URL, or nothing for the initial
 *   name: string,               // the person's display name
 *   size?: 'sm' | 'md' | 'lg',
 *   alt?: string,               // '' where the name is text beside it
 *   onError?: () => void,
 *   className?: string,
 * }} props
 */
export default function Avatar({ src, name, size = 'md', alt = '', onError, className = '' }) {
  const shared = ['avatar', SIZE_CLASS[size] ?? SIZE_CLASS.md, className].filter(Boolean).join(' ');
  if (!src) {
    return (
      <span aria-hidden="true" className={shared}>
        {initialOf(name)}
      </span>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={shared} onError={onError} />;
}
