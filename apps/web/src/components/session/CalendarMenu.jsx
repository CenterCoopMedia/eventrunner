// CalendarMenu — one control that adds one session to a calendar.
//
// Was CalendarPill, which was not one control at all: it printed the words
// "Add to calendar:" and then three bordered buttons beside them — .ics,
// Google, Outlook — under every session on the page. Three targets for one
// intention, repeated down the whole programme, and the reader has to
// decide which calendar they use before they can decide whether they want
// the session.
//
// So the intention is the control and the three destinations are its
// contents: one disclosure reading "Add to calendar", one list underneath
// once it is open.
//
// THE LIST OPENS IN FLOW, NOT OVER THE PAGE. A row lives inside a list that
// scrolls, and on a narrow screen a floating panel is a clipping bug
// waiting to happen. Opening in flow pushes the rows below it down, which
// is honest, needs no z-index, and reads the same at 320px as at 1440px.
// It is the same disclosure CallingPoints.jsx already uses.
//
// Escape closes it and returns focus to the control, which is what a
// keyboard reader expects of anything that opened.
import { useCallback, useRef, useState } from 'react';
import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  downloadIcs,
  icsFileName,
} from '../../utils/calendar.js';
import { rowActionClass } from './sessionActionClass.js';

/**
 * @param {{ eventConfig: object, session: object }} props
 */
export default function CalendarMenu({ eventConfig, session }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const googleUrl = buildGoogleCalendarUrl(eventConfig, session);
  const outlookUrl = buildOutlookCalendarUrl(eventConfig, session);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // The session's time could not be resolved (spec: fail soft) — nothing to
  // add to a calendar, so there is no control either.
  if (!googleUrl && !outlookUrl) return null;

  const listId = `calendar-choices-${session.id}`;

  const onDownload = () => {
    downloadIcs(icsFileName(session.title), buildIcsCalendar(eventConfig, [session]));
    close();
  };

  return (
    <span
      className="session-actions__menu inline-flex flex-col items-start"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className={rowActionClass}
      >
        Add to calendar
      </button>
      {open ? (
        <ul
          id={listId}
          aria-label={`Add ${session.title} to a calendar`}
          className="mt-2xs flex flex-col items-start gap-2xs ps-sm"
        >
          <li>
            <button type="button" className={rowActionClass} onClick={onDownload}>
              Calendar file (.ics)
            </button>
          </li>
          {googleUrl ? (
            <li>
              <a href={googleUrl} target="_blank" rel="noreferrer" className={rowActionClass}>
                Google Calendar
              </a>
            </li>
          ) : null}
          {outlookUrl ? (
            <li>
              <a href={outlookUrl} target="_blank" rel="noreferrer" className={rowActionClass}>
                Outlook
              </a>
            </li>
          ) : null}
        </ul>
      ) : null}
    </span>
  );
}
