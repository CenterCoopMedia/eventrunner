import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import { SIGNUPS_CLOSED, statusPath } from '../../setup/steps.js';
import { formatFee } from '../../text.js';

/** Going back asks once, in place. Cancel returns the focus to the button. */
function ChangeAnswers({ onConfirm }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = useRef(null);
  if (!asking) {
    return <button type="button" className="button" ref={button} onClick={() => setAsking(true)}>Change your answers</button>;
  }
  return (
    <div className="confirm" role="group" aria-label="Change your answers">
      <span>Go back and change your answers? An Owner then accepts the agreement again before paying.</span>
      <button type="button" className="button" disabled={busy}
        onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); setAsking(false); }}>
        Yes, change my answers
      </button>
      <button type="button" className="button" autoFocus onClick={() => { setAsking(false); setTimeout(() => button.current?.focus(), 0); }}>
        Cancel
      </button>
    </div>
  );
}

/**
 * The event fee. The amount shown comes from the server, and the browser
 * never sends one. Paying opens the payment page; only the server's own
 * confirmation counts as paid, so the status page waits for it.
 */
export default function FeeStep({ app, orgId, appId, copyFailed = false, onReopened, leave = (url) => window.location.assign(url) }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const fee = app.signups?.fee;

  async function pay() {
    setBusy(true);
    setError('');
    try {
      const result = await callApi('startFeeCheckout', { orgId, appId });
      if (result.alreadyPaid) setAlreadyPaid(true);
      else leave(result.url);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function reopen() {
    setError('');
    try {
      await callApi('reopenApplication', { orgId, appId });
      await onReopened();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack">
      {copyFailed ? <p className="message error">We could not email your copy of the agreement. You can read it on the Agreement step.</p> : null}
      {error ? <p className="message error" role="alert">{error}</p> : null}
      {fee ? <p className="lead">The event fee for your site is <strong>{formatFee(fee)}</strong>. We start building your site once your payment is confirmed.</p> : null}
      {!fee ? <p className="message error">{SIGNUPS_CLOSED}</p> : null}

      {alreadyPaid ? (
        <p className="message success" role="status">
          We already received your payment, and you will not be charged again. We are confirming it now. <Link to={statusPath(orgId, appId)}>See your request</Link>
        </p>
      ) : null}

      {fee && !alreadyPaid ? (
        <section className="summary" aria-labelledby="fee-how">
          <h2 id="fee-how">How paying works</h2>
          <ul>
            <li>Pay the event fee opens our secure payment page. You pay by card.</li>
            <li>If your card is declined, we take no money. You can try again on the same page, with the same card or another one.</li>
            <li>If you cancel or close the page, we take no money. You can come back here and pay when you are ready.</li>
            <li>After you pay, your request shows that we are waiting for payment confirmation. This can take a few minutes. We then email the Owners and start building your site.</li>
          </ul>
        </section>
      ) : null}

      {fee && !alreadyPaid && app.canPay ? (
        <div><button type="button" className="button primary" onClick={pay} disabled={busy}>Pay the event fee</button></div>
      ) : null}
      {!app.canPay ? <p className="muted">Only an Owner can pay the event fee. Ask an Owner on your team to open this step.</p> : null}
      {app.canPay && !alreadyPaid ? <div className="section"><ChangeAnswers onConfirm={reopen} /></div> : null}
    </div>
  );
}
