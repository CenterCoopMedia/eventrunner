// /admin/web-address: a custom web address, an optional upgrade (ADR 0007
// §8, P9a). The site already works at its own address. The operator types a
// domain, adds the records shown at their domain provider, and the server
// checks until the domain is live (functions/src/admin/webAddress.cjs).
import { useEffect, useRef, useState } from 'react';
import { useAdminApi } from '../adminApi.js';
import AdminPageHeader, { AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import { DestructiveConfirm, Notice, Panel, primaryButtonClass, secondaryButtonClass, TextField } from '../components/formControls.jsx';

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
  const [domain, setDomain] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    call('webAddress', { action: 'status' })
      .then((result) => { if (active) setStatus(result); })
      .catch((err) => { if (active) setNotice({ tone: 'error', message: err.message }); });
    return () => { active = false; };
  }, [call]);

  async function run(action, body = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setNotice(null);
    try {
      setStatus(await call('webAddress', { action, ...body }));
      if (action === 'add' || action === 'remove') setDomain('');
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
        description="Your site already works at its own address. A custom web address, such as summit.example.org, is optional."
      />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
      {!status && !notice ? <AdminLoadingState label="Loading the web address…" /> : null}
      {status ? (
        <Panel title="Current address">
          <p className="font-admin-data text-admin-base text-admin-ink">{status.currentAddress ?? 'Not set'}</p>
        </Panel>
      ) : null}

      {status?.state === 'none' ? (
        <Panel title="Use your own domain" description="Type the domain you want for the site. You need access to the place where you bought it, to add records there.">
          <form className="flex flex-col gap-sm" noValidate onSubmit={(event) => { event.preventDefault(); run('add', { domain }); }}>
            <TextField label="Your domain" value={domain} onChange={setDomain} hint="For example summit.example.org. No https:// and no path." autoComplete="off" autoCapitalize="none" />
            <div>
              <button type="submit" className={primaryButtonClass} aria-busy={busy === 'add' ? 'true' : undefined} aria-disabled={busy ? 'true' : undefined}>
                {busy === 'add' ? 'Adding…' : 'Add this address'}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      {status && status.state !== 'none' ? (
        <Panel title={status.domain}>
          <div className="flex flex-col gap-sm">
            {words ? <p><StatusBadge tone={words.tone}>{words.label}</StatusBadge></p> : null}
            {status.state === 'records' ? (
              <>
                <p className="text-admin-sm text-admin-ink">Add these records where you manage your domain. Changes there can take a few hours to reach everyone.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-admin-sm" aria-label="Records to add at your domain provider">
                    <thead>
                      <tr><th scope="col" className="py-2xs pr-sm">Type</th><th scope="col" className="py-2xs pr-sm">Name</th><th scope="col" className="py-2xs">Value</th></tr>
                    </thead>
                    <tbody>
                      {status.records.map((record) => (
                        <tr key={`${record.type}-${record.host}-${record.value}`} className="border-admin-rule-hairline border-t-admin-hairline">
                          <td className="py-2xs pr-sm font-admin-data">{record.type}</td>
                          <td className="wrap-anywhere py-2xs pr-sm font-admin-data">{record.host}</td>
                          <td className="wrap-anywhere py-2xs font-admin-data">{record.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {status.state === 'switch' ? (
              <p className="text-admin-sm text-admin-ink">The domain works and sign-in accepts it. The last step is to switch the site to it, which the hosting team does. Ask them to switch the site to {status.domain}.</p>
            ) : null}
            {status.state === 'done' ? <p className="text-admin-sm text-admin-ink">The site uses this address.</p> : null}
            <p className="text-admin-xs text-admin-ink-secondary">{checkedWords(status.lastCheckedAt)}</p>
            <div className="flex flex-wrap gap-sm">
              {status.state !== 'done' ? (
                <button type="button" className={secondaryButtonClass} onClick={() => run('check')} aria-busy={busy === 'check' ? 'true' : undefined} aria-disabled={busy ? 'true' : undefined}>
                  {busy === 'check' ? 'Checking…' : 'Check now'}
                </button>
              ) : null}
              <DestructiveConfirm
                trigger="Remove this address" title={`Remove ${status.domain}?`} confirmLabel="Remove address"
                busy={busy === 'remove'} busyLabel="Removing…"
                consequence="The site stops answering at this domain." permanence="You can add it again later."
                onConfirm={() => run('remove')}
              />
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
