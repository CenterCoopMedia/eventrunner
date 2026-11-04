import { useEffect, useRef, useState } from 'react';
import NoteForm from './NoteForm.jsx';

const SPAM_STATUSES = ['draft', 'withdrawn', 'declined'];
const ACCEPTED = ['approved', 'building'];

/** The decisions open to the hosting team for a request with this status. */
export function decisionsFor(status, canClose = false) {
  return {
    decline: status === 'draft',
    close: canClose,
    deleteSpam: SPAM_STATUSES.includes(status),
  };
}

/**
 * One decision at a time: a button opens its form, and Cancel closes it
 * and returns the focus to that button. `onDecide(name, body)` returns
 * true when the server accepted, or the error.
 */
export default function ReviewActions({ status, canClose = false, onDecide }) {
  const [open, setOpen] = useState(null);
  const [refocus, setRefocus] = useState(null);
  const openers = useRef({});
  const allowed = decisionsFor(status, canClose);

  useEffect(() => {
    if (refocus) {
      openers.current[refocus]?.focus();
      setRefocus(null);
    }
  }, [refocus]);

  function close() {
    setRefocus(open);
    setOpen(null);
  }

  const opener = (name, label, className = 'button') => (
    <button
      type="button"
      className={className}
      ref={(node) => { openers.current[name] = node; }}
      aria-expanded={open === name}
      onClick={() => setOpen(name)}
    >
      {label}
    </button>
  );

  if (!Object.values(allowed).some(Boolean)) {
    return (
      <p>
        {ACCEPTED.includes(status)
          ? 'To close this request, cancel its run first. You can close it once the run stops.'
          : 'No decision is open for a request with this status.'}
      </p>
    );
  }

  return (
    <div className="stack">
      {allowed.decline ? <div className="row-actions">{opener('decline', 'Decline', 'button danger')}</div> : null}

      {open === 'decline' ? (
        <NoteForm
          id="decline"
          title="Decline this request"
          help="Say why. The web address becomes free again, and the request is deleted after 90 days."
          submitLabel="Decline"
          danger
          onSubmit={async (note) => (await onDecide('declineApplication', { note })) === true}
          onCancel={close}
        />
      ) : null}

      {allowed.close ? <div className="row-actions">{opener('close', 'Close this request', 'button danger')}</div> : null}

      {open === 'close' ? (
        <NoteForm
          id="close"
          title="Close this request"
          help="Say why. The client's accounts are disconnected. The web address becomes free only if no build ever began, because a build may have used it for good. Anything the build already made, such as the Google Cloud project, stays until you remove it. The deploy runbook, section 12.2, lists it."
          submitLabel="Close the request"
          danger
          onSubmit={async (note) => (await onDecide('closeApplication', { note })) === true}
          onCancel={close}
        />
      ) : null}

      {allowed.deleteSpam ? <SpamDelete onDelete={() => onDecide('deleteSpamApplication', { confirm: true })} /> : null}
    </div>
  );
}

/** Delete as spam asks once, in place. Cancel takes the focus first, so a second Enter keeps the request. */
function SpamDelete({ onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef(null);
  const [refocus, setRefocus] = useState(false);

  useEffect(() => {
    if (refocus) {
      buttonRef.current?.focus();
      setRefocus(false);
    }
  }, [refocus]);

  async function remove() {
    setBusy(true);
    const done = await onDelete();
    if (done !== true) {
      setBusy(false);
      setConfirming(false);
      setRefocus(true);
    }
  }

  return (
    <section aria-labelledby="spam-title" className="section">
      <h3 id="spam-title">Spam</h3>
      {confirming ? (
        <div className="confirm" role="group" aria-label="Delete as spam">
          <span>Delete this request and free its web address? You cannot undo this.</span>
          <button type="button" className="button danger" disabled={busy} onClick={remove}>Yes, delete</button>
          <button type="button" className="button" autoFocus onClick={() => { setConfirming(false); setRefocus(true); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="button danger" ref={buttonRef} onClick={() => setConfirming(true)}>Delete as spam</button>
      )}
    </section>
  );
}
