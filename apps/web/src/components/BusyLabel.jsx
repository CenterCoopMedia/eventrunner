import { useEffect, useState } from 'react';
import { STAGES } from '../lib/useLoadingStage.js';
import { announce, withdraw } from '../lib/announce.js';

/** The waiting stage at which a busy control says it is late (ten seconds). */
export const LATE_AFTER = STAGES.find(([, stage]) => stage === 'slow')[0];

/** "Saving the session…" becomes "Still saving the session…". */
export function lateWords(pending) {
  return `Still ${pending.charAt(0).toLowerCase()}${pending.slice(1)}`;
}

/** True once `busy` has held for LATE_AFTER; false again the moment it ends. */
export function useBusyLate(busy) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!busy) return undefined;
    const timer = setTimeout(() => setLate(true), LATE_AFTER);
    return () => clearTimeout(timer);
  }, [busy]);
  return Boolean(busy) && late;
}

/**
 * The words inside a busy control. `pending` names the work ("Saving the
 * session…") and shows from the press. Past ten seconds the words say the
 * work is still going, and a screen reader hears that line once. The rest
 * label and the pending words hold the control's width from the start; the
 * late words wrap inside that width, so neighbours never move.
 *
 * The control itself keeps aria-busy and refuses a second press; this
 * component only owns the words.
 *
 * @param {{ busy: boolean, pending: string, late?: string, children: React.ReactNode }} props
 */
export default function BusyLabel({ busy, pending, late, children }) {
  const isLate = useBusyLate(busy);
  const lateText = late ?? lateWords(pending);
  const line = `${lateText.replace(/…$/, '.')} This is taking longer than usual.`;

  useEffect(() => {
    if (!isLate) return undefined;
    announce(line);
    return () => withdraw(line);
  }, [isLate, line]);

  return (
    <span className="inline-grid min-w-0">
      <span className={`[grid-area:1/1] ${busy ? 'invisible' : ''}`} aria-hidden={busy || undefined}>{children}</span>
      <span className={`[grid-area:1/1] ${busy && !isLate ? '' : 'invisible'}`} aria-hidden={!busy || isLate || undefined}>
        {pending}
      </span>
      {isLate ? <span className="[grid-area:1/1] w-0 min-w-full">{lateText}</span> : null}
    </span>
  );
}
