import { useEffect, useState } from 'react';
import WaitingBuddy from './WaitingBuddy.jsx';

/**
 * A decorative activity indicator beside the console's actual status. A wait
 * that usually runs several seconds (`long`) gets the jogging badge instead
 * of the small ring.
 *
 * `onRetry` is for a read only: past ten seconds a Try again control repeats
 * it. The caller makes the new read win over the one that has not answered
 * (a fresh effect run); the wait starts again from the press.
 * A write never gets one, because a second write could race the first.
 */
export default function LoadingState({ children, className = '', long = false, onRetry }) {
  const [stage, setStage] = useState('initial');
  const [attempt, setAttempt] = useState(0);
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
  function retry() {
    setStage('initial');
    setAttempt((value) => value + 1);
    onRetry();
  }
  const late = stage === 'slow' || stage === 'extended';
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
  if (!onRetry || !late) return status;
  return (
    <>
      {status}
      <p className="console-loading-retry">
        <button type="button" className="button" onClick={retry}>Try again</button>
      </p>
    </>
  );
}
