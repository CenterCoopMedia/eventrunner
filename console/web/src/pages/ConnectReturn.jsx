import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { callApi } from '../api.js';
import { PROVIDER_COPY, takeConnectReturn } from '../setup/connections.js';
import { setupPath, stepById } from '../setup/steps.js';
import LoadingState from '../LoadingState.jsx';

/**
 * Where a provider sends the client back to (ADR 0007 §4). This page hands
 * what the provider sent to the server with the signed-in user's ID token,
 * takes it out of the address at once, and returns the client to the page
 * they came from.
 */
export default function ConnectReturn() {
  const { provider } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const [failure, setFailure] = useState('');
  // A code works once, so this runs once, even when React runs an effect twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get('state');
    const code = search.get('code');
    const denied = search.has('error');
    const name = PROVIDER_COPY[provider]?.name || 'your';
    let target = takeConnectReturn();
    setSearch({}, { replace: true });

    (async () => {
      let message;
      try {
        const body = await callApi('completeConnection', { provider, state, ...(denied ? { denied: true } : { code }) });
        target = target || setupPath(body.orgId, body.appId, stepById('tickets'));
        message = body.connected
          ? { kind: 'success', text: `Your ${name} account is connected.` }
          : { kind: 'info', text: `You did not connect your ${name} account. You can try again when you are ready.` };
      } catch (err) {
        message = { kind: 'error', text: err.message };
      }
      if (target) navigate(target, { replace: true, state: { connectionMessage: message } });
      else setFailure(message.text);
    })();
    // Only the first render's address counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failure) {
    return (
      <section className="panel narrow" aria-labelledby="connect-title">
        <h1 id="connect-title" tabIndex={-1}>We could not connect your account</h1>
        <p className="message error" role="alert">{failure}</p>
        <p><Link to="/">Go to your organizations</Link></p>
      </section>
    );
  }
  return <LoadingState long>Connecting your account.</LoadingState>;
}
