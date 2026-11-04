import { useEffect, useRef, useState } from 'react';
import ApproveForm from './ApproveForm.jsx';
import NoteForm from './NoteForm.jsx';

const SPAM_STATUSES = ['draft', 'submitted', 'changes_requested', 'withdrawn', 'declined'];

/** The decisions open to the hosting team for a request with this status. */
export function decisionsFor(status) {
  return {
    requestChanges: status === 'submitted',
    approve: status === 'submitted',
    decline: status === 'submitted' || status === 'changes_requested',
    deleteSpam: SPAM_STATUSES.includes(status),
  };
}

/**
 * One decision at a time: a button opens its form, and Cancel closes it
 * and returns the focus to that button. `onDecide(name, body)` returns
 * true when the server accepted, or the error.
 */
export default function ReviewActions({ status, defaults, onDecide }) {
  const [open, setOpen] = useState(null);
  const [refocus, setRefocus] = useState(null);
  const openers = useRef({});
  const allowed = decisionsFor(status);

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
    return <p>No decision is open for a request with this status.</p>;
  }

  return (
    <div className="stack">
      <div className="row-actions">
        {allowed.approve ? opener('approve', 'Approve', 'button primary') : null}
        {allowed.requestChanges ? opener('changes', 'Request changes') : null}
        {allowed.decline ? opener('decline', 'Decline', 'button danger') : null}
      </div>

      {open === 'changes' ? (
        <NoteForm
          id="changes"
          title="Request changes"
          help="Say what the client must change. The client can then send the request again."
          submitLabel="Send the request for changes"
          onSubmit={async (note) => (await onDecide('requestChanges', { note })) === true}
          onCancel={close}
        />
      ) : null}
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
      {open === 'approve' ? (
        <ApproveForm defaults={defaults} onSubmit={(settings) => onDecide('approveApplication', { settings })} onCancel={close} />
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
