// /admin/web-address: current address and connection status. The team sets
// up custom domains; clients can check an existing connection.
import { useEffect, useRef, useState } from 'react';
import { useAdminApi } from '../adminApi.js';
import AdminPageHeader, { AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import { Notice, Panel, secondaryButtonClass } from '../components/formControls.jsx';

const STATE_WORDS = {
  records: { tone: 'caution', label: 'Waiting for the records' },
  switch: { tone: 'info', label: 'Ready to switch' },
  done: { tone: 'ok', label: 'In use' },
};

function checkedWords(iso) {
  if (!iso) return 'Not checked yet. The site checks every hour.';
  return `Last checked ${new Date(iso).toLocaleString()}. The site also checks every hour.`;
}

export default function AdminWebAddress() {
  const call = useAdminApi();
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const busyRef = useRef(false);
  const outcomeRef = useRef(null);

  useEffect(() => {
    let active = true;
    setNotice(null);
    call('webAddress', { action: 'status' })
      .then((result) => { if (active) setStatus(result); })
      .catch((err) => { if (active) setNotice({ tone: 'error', message: err.message }); });
    return () => { active = false; };
  }, [call, loadAttempt]);

  useEffect(() => { if (notice) outcomeRef.current?.focus(); }, [notice]);

  async function check() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('check');
    setNotice(null);
    try {
      const next = await call('webAddress', { action: 'check' });
      setStatus(next);
      setNotice({ tone: 'ok', message: `Address checked. ${STATE_WORDS[next.state]?.label ?? 'The current status is shown below'}.` });
    } catch (err) {
      setNotice({ tone: 'error', message: err.message });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const words = STATE_WORDS[status?.state];
  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Web address"
        description="Your site's current web address and connection status."
      />
      <p className="text-admin-sm text-admin-ink-secondary">Want to use your own domain? Contact us and we'll set it up.</p>
      {!status && notice ? <div ref={outcomeRef} tabIndex={-1}><Notice tone={notice.tone} message={notice.message} /><button type="button" className={secondaryButtonClass} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></div> : null}
      {!status && !notice ? <AdminLoadingState label="Loading the web address…" /> : null}
      {status ? (
        <Panel title="Current address">
          <p className="font-admin-data text-admin-base text-admin-ink">{status.currentAddress ?? 'Not set'}</p>
        </Panel>
      ) : null}

      {status && status.state !== 'none' ? (
        <Panel title={status.domain}>
          <div className="flex flex-col gap-sm">
            {words ? <p><StatusBadge tone={words.tone}>{words.label}</StatusBadge></p> : null}
            {status.state === 'records' ? (
              <p className="text-admin-sm text-admin-ink">Your domain is being connected. Contact us if you need help.</p>
            ) : null}
            {status.state === 'switch' ? (
              <p className="text-admin-sm text-admin-ink">The domain works and sign-in accepts it. The last step is to switch the site to it, which the hosting team does. Ask them to switch the site to {status.domain}.</p>
            ) : null}
            {status.state === 'done' ? <p className="text-admin-sm text-admin-ink">The site uses this address.</p> : null}
            <p className="text-admin-xs text-admin-ink-secondary">{checkedWords(status.lastCheckedAt)}</p>
            <div className="flex flex-wrap gap-sm">
              {status.state !== 'done' ? (
                <button type="button" className={secondaryButtonClass} onClick={check} aria-busy={busy === 'check' ? 'true' : undefined} aria-disabled={busy ? 'true' : undefined}>
                  {busy === 'check' ? 'Checking…' : 'Check now'}
                </button>
              ) : null}
            </div>
            {notice ? <div ref={outcomeRef} tabIndex={-1}><Notice tone={notice.tone} message={notice.message} /></div> : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
