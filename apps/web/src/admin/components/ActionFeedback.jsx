import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { secondaryButtonClass } from './formControls.jsx';
import './actionFeedback.css';

/** One durable result, next to the action that produced it. */
export function ActionFeedback({ message, tone = 'ok', announce = true, className = '' }) {
  if (!message) return null;
  return (
    <p role={announce ? (tone === 'error' ? 'alert' : 'status') : undefined} className={`admin-action-feedback admin-action-feedback--${tone} ${className}`}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="8" />
        {tone === 'error' ? <path d="M10 5v6m0 3h.01" /> : <path d="m6 10 3 3 5-6" />}
      </svg>
      {message}
    </p>
  );
}

/** The detail summary announces errors; this compact repeat stays by Save. */
export function EditorActionFeedback({ status, error, errorTitle, tone = 'ok', unsaved = false }) {
  return <ActionFeedback
    message={error
      ? (errorTitle ? `${errorTitle}. Review the error below.` : 'The action failed. Review the error below.')
      : status && unsaved ? `${status} Newer edits are still unsaved.` : status}
    tone={error ? 'error' : tone}
    announce={!error}
    className="admin-editor-action-feedback"
  />;
}

/** Restore focus only if an action removed its trigger and focus was lost. */
export function useActionResultFocus(busy) {
  const pressed = useRef(null);
  const results = useRef(new Map());
  useEffect(() => {
    const action = pressed.current;
    if (!action || busy) return;
    const result = results.current.get(action.key);
    if (!result?.textContent) return;
    if (action.node?.isConnected) {
      if (!action.revealed && document.activeElement === action.node) {
        result.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      }
      action.revealed = true;
      return;
    }
    pressed.current = null;
    if (!document.activeElement || document.activeElement === document.body) {
      result.focus({ preventScroll: true });
      result.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    }
  });
  return {
    remember(key) { pressed.current = { key, node: document.activeElement }; },
    resultRef(key) {
      return (node) => {
        if (node) results.current.set(key, node);
        else results.current.delete(key);
      };
    },
  };
}

/** Familiar edit utility, with the full purpose on keyboard focus and hover. */
export function EditRecordLink({ to, label }) {
  const [hintDismissed, setHintDismissed] = useState(false);
  return (
    <Link to={to} aria-label={label} className={`${secondaryButtonClass} admin-record-edit`}
      data-hint-dismissed={hintDismissed}
      onFocus={() => setHintDismissed(false)}
      onMouseEnter={() => setHintDismissed(false)}
      onKeyDown={(event) => { if (event.key === 'Escape') setHintDismissed(true); }}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
      </svg>
      <span aria-hidden="true" className="admin-record-edit__hint">{label}</span>
    </Link>
  );
}
