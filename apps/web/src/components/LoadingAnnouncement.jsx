import { useEffect, useRef, useState } from 'react';
import { STAGES } from '../lib/useLoadingStage.js';

export const WAITING_DETAILS = {
  slow: 'This is taking longer than usual. We’re still waiting for a response.',
  prolonged: 'We haven’t received a result after a minute. You can keep waiting.',
};

const COMPLETION_DELAY_MS = 300;

export default function LoadingAnnouncement({
  label, stage, clock, result, resultClassName, prolongedAnnouncement, active = true, completion,
}) {
  const [announcement, setAnnouncement] = useState(null);
  const [completed, setCompleted] = useState('');
  const localClock = useRef({});
  const primed = useRef(false);
  const activeWait = useRef(null);

  useEffect(() => {
    const previous = activeWait.current;
    if (!active) {
      activeWait.current = null;
      if (previous) {
        setCompleted(completion && performance.now() - previous.startedAt >= COMPLETION_DELAY_MS ? completion : '');
      } else {
        setCompleted((message) => message === completion ? message : '');
      }
      primed.current = true;
      return undefined;
    }
    if (!previous) setCompleted('');
    if (clock) {
      // Changing work keeps the completion clock. Retrying the same work
      // starts a new attempt and may finish before the speech threshold.
      const continued = previous && (previous.clock === clock || previous.label !== label);
      activeWait.current = { clock, label, startedAt: continued ? previous.startedAt : clock.startedAt };
    }

    if (result !== undefined || stage === 'initial' || !label) {
      setAnnouncement(null);
      localClock.current.announcedStage = 0;
      primed.current = true;
      return undefined;
    }

    const attempt = clock ?? localClock.current;
    const stageNumber = STAGES.findIndex(([, name]) => name === stage) + 1;
    if (stageNumber <= (attempt.announcedStage ?? 0)) {
      if (previous && previous.label !== label) setAnnouncement(null);
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
      setAnnouncement({ label, message });
    };
    if (primed.current) {
      announce();
      return undefined;
    }

    // An inherited wait can mount past a deadline. Give the empty region a
    // paint before writing its first line so it is registered by the reader.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(announce); });
    return () => cancelAnimationFrame(frame);
  }, [active, clock, completion, label, prolongedAnnouncement, result, stage]);

  const waiting = announcement && stage !== 'initial' && announcement.label === label ? announcement.message : '';
  const settled = completed === completion ? completed : '';
  return (
    <p className={result === undefined ? 'sr-only' : resultClassName} role="status" aria-live="polite" aria-atomic="true">
      {result ?? (active ? waiting : settled)}
    </p>
  );
}
