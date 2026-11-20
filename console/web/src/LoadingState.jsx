import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import WaitingBuddy from './WaitingBuddy.jsx';

/**
 * A decorative activity indicator beside the console's actual status. A wait
 * that usually runs several seconds (`long`) gets the jogging badge instead
 * of the small ring.
 *
 * `onRetry` is for a read only: past ten seconds a Try again control repeats
 * it. The caller makes the new read win over the one that has not answered
 * (a fresh effect run); the wait starts again from the press. The control
 * stays where the keyboard is, busy, until the new read answers or reaches
 * ten seconds itself. When the content replaces it, focus moves to the
 * page's heading rather than falling to the document.
 * A write never gets one, because a second write could race the first.
 */
export default function LoadingState({ children, className = '', long = false, onRetry }) {
  const [stage, setStage] = useState('initial');
  const [attempt, setAttempt] = useState(0);
  const retryRef = useRef(null);
  useLayoutEffect(() => () => {
    if (document.activeElement !== retryRef.current || !retryRef.current) return;
    queueMicrotask(() => document.querySelector('main h1')?.focus());
  }, []);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('active'), 1000),
      setTimeout(() => setStage('slow'), 10000),
      setTimeout(() => setStage('extended'), 60000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [attempt]);
  const detail = stage === 'extended'
      ? 'No result yet. You can keep waiting or check your connection.'
    : stage === 'slow' ? 'This is taking longer than expected.' : '';
  const late = stage === 'slow' || stage === 'extended';
  const retrying = attempt > 0 && !late;
  function retry() {
    if (retrying) return;
    setStage('initial');
    setAttempt((value) => value + 1);
    onRetry();
  }
  const status = (
    <p role="status" aria-atomic="true" data-loading-stage={stage} className={`console-loading ${long ? 'console-loading-long' : ''} ${className}`.replace(/\s+/g, ' ').trim()}>
      <span className="console-loading-indicator" aria-hidden="true">
        {long ? <WaitingBuddy /> : <span className="console-spinner" />}
      </span>
      <span className="console-loading-copy">
        <span>{children}</span>
        {detail ? <span className="console-loading-detail">{detail}</span> : null}
      </span>
    </p>
  );
  if (!onRetry || (!late && !retrying)) return status;
  return (
    <>
      {status}
      <p className="console-loading-retry">
        <button ref={retryRef} type="button" className="button" aria-busy={retrying || undefined}
          aria-disabled={retrying || undefined} onClick={retry}>{retrying ? 'Trying again…' : 'Try again'}</button>
      </p>
    </>
  );
}
