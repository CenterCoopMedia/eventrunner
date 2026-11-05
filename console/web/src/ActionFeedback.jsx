import { useEffect, useRef } from 'react';
import './actionFeedback.css';

/** An action's result stays beside its controls, including after a failed refresh. */
export default function ActionFeedback({ kind = 'success', children, focusRef, id, revealKey }) {
  const element = useRef(null);
  useEffect(() => {
    if (!revealKey || !element.current) return;
    const bounds = element.current.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) element.current.scrollIntoView?.({ block: 'nearest' });
  }, [revealKey]);
  if (!children) return null;
  return (
    <div id={id} ref={(node) => { element.current = node; if (focusRef) focusRef.current = node; }} tabIndex={focusRef ? -1 : undefined}
      className={`console-feedback console-feedback-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <svg className="console-feedback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        {kind === 'success' ? <path d="m7.5 12 3 3 6-6" /> : <path d="M12 7v6m0 3v1" />}
      </svg>
      <div>{children}</div>
    </div>
  );
}

/** A retry here only reads fresh data; it never repeats the completed action. */
export function ActionResult({ result, onRefresh, refreshing = false, refreshLabel = 'Refresh', focusRef }) {
  if (!result) return null;
  return (
    <ActionFeedback kind={result.kind} focusRef={focusRef} revealKey={`${result.message} ${result.refreshError || ''}`}>
      <p>{result.message}</p>
      {result.refreshError ? (
        <>
          <p>{result.refreshError}</p>
          {onRefresh ? <button type="button" className="button" title={refreshLabel} disabled={refreshing} onClick={onRefresh}>
            <span aria-hidden="true">↻ </span>{refreshing ? 'Refreshing…' : refreshLabel}
          </button> : null}
        </>
      ) : null}
    </ActionFeedback>
  );
}
