import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import PlannerSwitch from './PlannerSwitch.jsx';
import { Notice, Panel } from './formControls.jsx';

// updateFeatures replaces the document. Only offer these controls once its
// live values have arrived, and retain every other flag in each write.
export default function PlannerFeatureControls({ choices }) {
  const { isOperator } = useAuth();
  const { features, sources } = useEventConfig();
  const call = useAdminApi();
  const pending = useRef(false);
  const latest = useRef(features);
  useEffect(() => { latest.current = features; }, [features]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  if (!isOperator) return null;
  async function change(key, enabled) {
    if (pending.current || sources?.features !== 'live') return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const next = { ...latest.current, [key]: enabled };
      await call('updateFeatures', { features: next });
      latest.current = next;
      setNotice({ tone: 'ok', message: 'Updated.' });
    } catch {
      setNotice({ tone: 'error', message: 'The setting was not saved. Try again.' });
    } finally { pending.current = false; setBusy(false); }
  }
  return <Panel title="On the event site">
    <div className="flex flex-col gap-sm">
      {choices.map(({ key, label }) => <PlannerSwitch key={key} label={label} checked={features?.[key] === true}
        disabled={busy || sources?.features !== 'live'} onChange={(value) => change(key, value)} />)}
      {sources?.features !== 'live' ? <p role="status" className="text-admin-sm text-admin-ink-secondary">Loading settings…</p> : null}
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
    </div>
  </Panel>;
}
