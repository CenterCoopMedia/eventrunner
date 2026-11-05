import WaitingBuddy from './WaitingBuddy.jsx';

/**
 * A decorative activity indicator beside the console's actual status. A wait
 * that usually runs several seconds (`long`) gets the jogging badge instead
 * of the small ring.
 */
export default function LoadingState({ children, className = '', long = false }) {
  return (
    <p role="status" aria-atomic="true" className={`console-loading ${long ? 'console-loading-long' : ''} ${className}`.replace(/\s+/g, ' ').trim()}>
      {long ? <WaitingBuddy /> : <span className="console-spinner" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}
