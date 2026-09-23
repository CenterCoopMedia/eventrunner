// StateMarker — "Now", "Next", "Finished" on a session row during the event
// (expansion record §3.2).
//
// A WORD IN THE DATA FACE WITH AN INK CHANGE AND A RULE. The word is the
// signal; the ink and the rule under it are the second and third, so a
// reader who cannot see colour still has the word and the weight, and a
// reader scanning still catches the mark. It is never a pill and never a
// dot. A live session takes the accent, a finished one takes the back-issue
// ink and drops to the hairline, so a row that has passed reads quieter and
// never disappears.
//
// Three tones, and each one is a moment rather than a mood: `live` for a
// session running now, `next` for the one about to start, `past` for one
// that has finished.

const TONE_CLASS = Object.freeze({
  live: 'state-marker--live',
  next: 'state-marker--next',
  past: 'state-marker--past',
});

/**
 * @param {{
 *   tone: 'live' | 'next' | 'past',
 *   children: import('react').ReactNode,   // the word
 *   className?: string,
 * }} props
 */
export default function StateMarker({ tone, children, className = '' }) {
  if (!children) return null;
  return (
    <span className={['state-marker', TONE_CLASS[tone] ?? TONE_CLASS.next, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
