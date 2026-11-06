import { useEffect, useState } from 'react';
import WaitingBuddy from './WaitingBuddy.jsx';

/**
 * A decorative activity indicator beside the console's actual status. A wait
 * that usually runs several seconds (`long`) gets the jogging badge instead
 * of the small ring.
 */
export default function LoadingState({ children, className = '', long = false }) {
  const [stage, setStage] = useState('initial');
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('active'), 1000),
      setTimeout(() => setStage('slow'), 10000),
      setTimeout(() => setStage('extended'), 60000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  const detail = stage === 'extended'
      ? 'No result yet. You can keep waiting or check your connection.'
    : stage === 'slow' ? 'This is taking longer than expected.' : '';
  return (
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
}
