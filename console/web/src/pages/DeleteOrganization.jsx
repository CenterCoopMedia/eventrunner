import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { callApi } from '../api.js';

/** Destructive operator action. The server checks whether the organization was ever used. */
export default function DeleteOrganization({ organization }) {
  const navigate = useNavigate();
  const id = useId();
  const dialog = useRef(null);
  const cancel = useRef(null);
  const trigger = useRef(null);
  const sending = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const node = dialog.current;
    if (open) {
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
      cancel.current?.focus();
    } else if (node.open) {
      if (typeof node.close === 'function') node.close();
      else node.removeAttribute('open');
      trigger.current?.focus();
    }
  }, [open]);

  async function remove() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await callApi('deleteOrganization', { orgId: organization.id, confirm: true });
      navigate('/', { replace: true, state: { deletedOrganization: organization.name } });
    } catch (err) {
      setError(err.message);
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Delete unused organization</h2>
      <p>Only an organization whose requests were never approved or built can be deleted. For an existing site, use the archive workflow.</p>
      <button type="button" className="button danger" ref={trigger} onClick={() => { setError(''); setOpen(true); }}>Delete organization</button>
      <dialog ref={dialog} className="report-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
        onClose={() => setOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); }}>
        <h2 id={`${id}-title`}>Delete {organization.name}?</h2>
        <p id={`${id}-description`}>This deletes {organization.name}, its team, invites, linked signup links, and unused requests. Deletion cannot be undone.</p>
        {error ? <p className="message error" role="alert">{error}</p> : null}
        <div className="row-actions">
          <button type="button" className="button" ref={cancel} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="button danger" disabled={busy} aria-busy={busy || undefined} onClick={remove}>{busy ? 'Deleting…' : 'Delete this organization'}</button>
        </div>
      </dialog>
    </section>
  );
}
