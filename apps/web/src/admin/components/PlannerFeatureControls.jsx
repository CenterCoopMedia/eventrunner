import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { settingsConflict } from '../settingsChanges.js';
import PlannerSwitch from './PlannerSwitch.jsx';
import { Notice, Panel } from './formControls.jsx';

export default function PlannerFeatureControls({ choices }) {
  const { isOperator } = useAuth();
  const { features, liveFeatures, sources } = useEventConfig();
  const call = useAdminApi();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const unconfirmed = Object.entries(awaiting).filter(([key, enabled]) => (features?.[key] === true) !== enabled);
    if (unconfirmed.length !== Object.keys(awaiting).length) setAwaiting(Object.fromEntries(unconfirmed));
  }, [features, awaiting]);

  if (!isOperator) return null;
  async function change(key, label, enabled) {
    if (pending.current || Object.hasOwn(awaiting, key) || sources?.features !== 'live') return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await call('updateFeatures', {
        features: {
          changes: { [key]: enabled },
          expected: { [key]: (liveFeatures ?? features)?.[key] ?? null },
        },
      });
      setAwaiting((current) => ({ ...current, [key]: enabled }));
      setNotice({ tone: 'ok', message: 'Updated.' });
    } catch (error) {
      setNotice({ tone: 'error', message: settingsConflict(error, { [`features.${key}`]: label })?.message
        ?? 'The setting was not saved. Try again.' });
    } finally { pending.current = false; setBusy(false); }
  }
  return <Panel title="On the event site">
    <div className="flex flex-col gap-sm">
      {choices.map(({ key, label }) => <PlannerSwitch key={key} label={label} checked={features?.[key] === true}
        disabled={busy || Object.hasOwn(awaiting, key) || sources?.features !== 'live'} onChange={(value) => change(key, label, value)} />)}
      {sources?.features !== 'live' ? <p role="status" className="text-admin-sm text-admin-ink-secondary">Loading settings…</p> : null}
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
    </div>
  </Panel>;
}
