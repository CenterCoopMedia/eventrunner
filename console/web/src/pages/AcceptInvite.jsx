import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { callApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { withArticle } from '../text.js';

/** The token sits after `#` in the link, so no server log holds it. */
export function tokenFrom(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return params.get('token') || '';
}

/** /invite/:inviteId#token=… : the page the invite email opens. */
export default function AcceptInvite() {
  const { inviteId } = useParams();
  const location = useLocation();
  const auth = useAuth();
  const [token] = useState(() => tokenFrom(location.hash));
  const [joined, setJoined] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setJoined(await callApi('acceptInvite', { inviteId, token }));
    } catch (err) {
      setError({ code: err.code, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <section className="panel narrow" aria-labelledby="invite-title">
        <h1 id="invite-title" tabIndex={-1}>Join the team</h1>
        <p className="message error" role="alert">
          This invite link is not complete. Open the link in the invite email again.
        </p>
      </section>
    );
  }

  if (joined) {
    return (
      <section className="panel narrow" aria-labelledby="invite-title">
        <h1 id="invite-title" tabIndex={-1}>Join the team</h1>
        <p className="message success" role="status">
          You joined {joined.organization.name} as {withArticle(joined.role)}.
        </p>
        <p><Link to={`/organizations/${joined.organization.id}/team`}>Go to the team</Link></p>
      </section>
    );
  }

  return (
    <section className="panel narrow" aria-labelledby="invite-title">
      <h1 id="invite-title" tabIndex={-1}>Join the team</h1>
      <p>You are signed in as {auth.user?.email}. Use the email address that received the invite.</p>
      {error ? (
        <div className="stack">
          <p className="message error" role="alert">{error.message}</p>
          {error.code === 'wrong-email' ? (
            <button type="button" className="button" onClick={() => auth.signOut()}>Sign out</button>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="button primary" disabled={busy} onClick={accept}>{busy ? 'Joining…' : 'Join team'}</button>
    </section>
  );
}
