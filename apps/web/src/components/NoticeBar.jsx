// NoticeBar — a site-wide message with a level (expansion record §3.2).
//
// A RULED BAND UNDER THE HEADER. `role="status"` for information and
// `role="alert"` for something urgent, so the level is what assistive
// technology announces as well as what the reader sees. The level is a
// word and a rule weight — "Notice" on the hairline, "Urgent" on the strong
// rule — and never a colour on its own (brief §2.4).
//
// DISMISSED, AND REMEMBERED PER BROWSER. A reader who has read a notice
// should not meet it on every page. The dismissal is keyed by the notice's
// own id, so a NEW notice under the same slot is shown again, and it lives
// in localStorage, which is the right scope for "this reader, this
// browser". Storage may be unavailable (a private window, a locked-down
// device); the bar then shows every time, which is the safe failure.
//
// THE KEY IS THE CURRENT ID, NOT THE ONE AT MOUNT (adversarial review of the
// 2026-09-10 wave). The slot under the header stays mounted while the
// notice inside it changes, so the answer to "has this reader dismissed
// this notice" is asked of the id the bar is showing now, on every render:
// a dismissal is remembered as the id it dismissed, and storage is read
// again when the id changes. An urgent notice that replaces a dismissed one
// therefore shows.
//
// FOCUS GOES SOMEWHERE STATED. The dismiss control is inside the bar, and
// the bar leaves the document when pressed; an element removed while it
// holds focus drops focus to the body, which sends a keyboard reader back
// to the top of the page. So the bar hands focus to the main landmark
// (`#main-content`, which the shell renders with tabindex -1 as the skip
// link's target), or to whatever the caller names instead.
//
// The message is the operator's, and this component draws whatever it is
// handed. What carries a notice into the shell — a content slot, a field on
// config/event — is the milestones' work (issues 196 and 199).
import { useState } from 'react';
import { quietActionClass } from './controlClasses.js';

const STORAGE_PREFIX = 'notice-dismissed:';

/** The two levels, each a word and a role. */
export const NOTICE_LEVELS = Object.freeze({
  info: Object.freeze({ word: 'Notice', role: 'status' }),
  urgent: Object.freeze({ word: 'Urgent', role: 'alert' }),
});

/** Whether this browser has dismissed the notice with this id. */
export function isNoticeDismissed(id) {
  try {
    return globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${id}`) === '1';
  } catch {
    return false;
  }
}

/** Remember the dismissal. A storage refusal is not an error a reader sees. */
export function rememberNoticeDismissed(id) {
  try {
    globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${id}`, '1');
  } catch {
    // Storage is unavailable; the bar shows again next time.
  }
}

/**
 * @param {{
 *   id: string,                      // what the dismissal is remembered by
 *   level?: 'info' | 'urgent',
 *   children: import('react').ReactNode,   // the message
 *   dismissLabel?: string,
 *   onDismiss?: () => void,
 *   remember?: boolean,              // false only in the specimen book, which
 *                                    // must keep drawing a dismissed bar
 *   focusTargetId?: string,          // where focus goes after a dismissal
 *   className?: string,
 * }} props
 */
export default function NoticeBar({
  id,
  level = 'info',
  children,
  dismissLabel = 'Dismiss this notice',
  onDismiss,
  remember = true,
  focusTargetId = 'main-content',
  className = '',
}) {
  // The id this bar dismissed, if it has dismissed one. Keyed by id rather
  // than a flag, so a different notice arriving in the same slot is not
  // hidden by the dismissal of the one before it.
  const [dismissedId, setDismissedId] = useState(null);
  const dismissed = dismissedId === id || (remember && isNoticeDismissed(id));
  const shape = NOTICE_LEVELS[level] ?? NOTICE_LEVELS.info;
  if (dismissed || children === null || children === undefined || children === '') return null;

  function dismiss() {
    if (remember) rememberNoticeDismissed(id);
    setDismissedId(id);
    onDismiss?.();
    const target = globalThis.document?.getElementById(focusTargetId);
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  return (
    <div
      role={shape.role}
      className={[
        'notice-bar',
        level === 'urgent' ? 'notice-bar--urgent' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="stage flex flex-wrap items-baseline gap-x-md gap-y-xs">
        <span className="notice-bar__word text-folio font-semibold text-text-primary">{shape.word}</span>
        <p className="min-w-0 flex-1 text-body text-text-primary text-pretty">{children}</p>
        <button type="button" className={quietActionClass} onClick={dismiss}>
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
