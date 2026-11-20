import { useEffect, useRef, useState } from 'react';
import { STAGES } from '../lib/useLoadingStage.js';

export const WAITING_DETAILS = {
  slow: 'This is taking longer than usual. We’re still waiting for a response.',
  prolonged: 'We haven’t received a result after a minute. You can keep waiting.',
};

export default function LoadingAnnouncement({ label, stage, clock, result, resultClassName, prolongedAnnouncement }) {
  const [announcement, setAnnouncement] = useState('');
  const localClock = useRef({});
  const primed = useRef(false);

  useEffect(() => {
    if (result !== undefined || stage === 'initial' || !label) {
      setAnnouncement('');
      localClock.current.announcedStage = 0;
      primed.current = true;
      return undefined;
    }

    const attempt = clock ?? localClock.current;
    const stageNumber = STAGES.findIndex(([, name]) => name === stage) + 1;
    if (stageNumber <= (attempt.announcedStage ?? 0)) {
      primed.current = true;
      return undefined;
    }
    const message = stage === 'prolonged' && prolongedAnnouncement
      ? `${prolongedAnnouncement} ${WAITING_DETAILS[stage]}` : WAITING_DETAILS[stage] ?? label;
    const announce = () => {
      primed.current = true;
      // A route's chunk and data loaders may mount separately on the same clock.
      if (stageNumber <= (attempt.announcedStage ?? 0)) return;
      attempt.announcedStage = stageNumber;
      setAnnouncement(message);
    };
    if (primed.current) {
      announce();
      return undefined;
    }

    // An inherited wait can mount past a deadline. Give the empty region a
    // paint before writing its first line so it is registered by the reader.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(announce); });
    return () => cancelAnimationFrame(frame);
  }, [clock, label, prolongedAnnouncement, result, stage]);

  return (
    <p className={result === undefined ? 'sr-only' : resultClassName} role="status" aria-live="polite" aria-atomic="true">
      {result ?? (stage === 'initial' ? '' : announcement)}
    </p>
  );
}
