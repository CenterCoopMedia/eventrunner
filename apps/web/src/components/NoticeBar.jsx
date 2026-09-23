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
  className = '',
}) {
  const [dismissed, setDismissed] = useState(() => remember && isNoticeDismissed(id));
  const shape = NOTICE_LEVELS[level] ?? NOTICE_LEVELS.info;
  if (dismissed || children === null || children === undefined || children === '') return null;

  function dismiss() {
    if (remember) rememberNoticeDismissed(id);
    setDismissed(true);
    onDismiss?.();
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
