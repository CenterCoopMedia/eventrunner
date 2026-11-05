import { useEffect, useRef, useState } from 'react';
import { ActionResult } from '../../ActionFeedback.jsx';
import NoteForm from './NoteForm.jsx';

const SPAM_STATUSES = ['draft', 'withdrawn', 'declined'];
const ACCEPTED = ['approved', 'building'];

/** The decisions open to the hosting team for a request with this status. */
export function decisionsFor(status, canClose = false) {
  return { decline: status === 'draft', close: canClose, deleteSpam: SPAM_STATUSES.includes(status) };
}

/** One decision at a time, with a retained form on failure and a local result. */
export default function ReviewActions({ status, canClose = false, onDecide, busy, disabled, result, onRefresh, refreshing }) {
  const [open, setOpen] = useState(null);
  const [refocus, setRefocus] = useState(null);
  const openers = useRef({});
  const resultRef = useRef(null);
  const allowed = decisionsFor(status, canClose);

  useEffect(() => {
    if (refocus) {
      openers.current[refocus]?.focus();
      setRefocus(null);
    }
  }, [refocus]);

  useEffect(() => {
    if (result?.kind === 'success' && !open) resultRef.current?.focus();
  }, [result, open]);

  function close() {
    setRefocus(open);
    setOpen(null);
  }

  async function submit(name, body) {
    if (busy || disabled) return;
    if (await onDecide(name, body) === true) setOpen(null);
  }

  const opener = (name, label) => (
    <button type="button" className="button danger" disabled={busy || disabled}
      ref={(node) => { openers.current[name] = node; }} aria-expanded={open === name}
      onClick={() => setOpen(name)}>{label}</button>
  );

  return (
    <div className="stack">
      {!Object.values(allowed).some(Boolean) ? <p>{ACCEPTED.includes(status)
        ? 'To close this request, cancel its run first. You can close it once the run stops.'
        : 'No decision is open for a request with this status.'}</p> : null}
      {allowed.decline ? <div className="row-actions">{opener('decline', 'Decline')}</div> : null}
      {open === 'decline' ? <NoteForm id="decline" title="Decline this request"
        help="Say why. The web address becomes free again, and the request is deleted after 90 days."
        submitLabel="Decline" danger disabled={disabled} result={result?.kind === 'error' ? result : null}
        onSubmit={(note) => submit('declineApplication', { note })} onCancel={close} /> : null}
      {allowed.close ? <div className="row-actions">{opener('close', 'Close this request')}</div> : null}
      {open === 'close' ? <NoteForm id="close" title="Close this request"
        help="Say why. Cancel any deploy run for this site first. The console drops the client's account connections. The web address becomes free only if no build ever began, because a build may have used it for good. Anything the build already made stays until you remove it, including the Google Cloud project and any Eventbrite token stored in it. The deploy runbook, section 12.2, lists it."
        submitLabel="Close the request" danger disabled={disabled} result={result?.kind === 'error' ? result : null}
        onSubmit={(note) => submit('closeApplication', { note })} onCancel={close} /> : null}
      {allowed.deleteSpam ? (
        <section aria-labelledby="spam-title" className="section">
          <h3 id="spam-title">Spam</h3>
          {open === 'spam' ? (
            <>
              <div className="confirm" role="group" aria-label="Delete as spam">
                <span>Delete this request and free its web address? You cannot undo this.</span>
                <button type="button" className="button danger" disabled={busy || disabled}
                  onClick={() => submit('deleteSpamApplication', { confirm: true })}>{busy ? 'Deleting…' : 'Yes, delete'}</button>
                <button type="button" className="button" autoFocus disabled={busy || disabled} onClick={close}>Cancel</button>
              </div>
              <ActionResult result={result?.kind === 'error' ? result : null} />
            </>
          ) : opener('spam', 'Delete as spam')}
        </section>
      ) : null}
      {!open ? <ActionResult result={result} focusRef={resultRef} onRefresh={onRefresh} refreshing={refreshing} refreshLabel="Refresh request" /> : null}
    </div>
  );
}
