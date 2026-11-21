import { useEffect, useState } from 'react';
import AdminPendingSave, { useAdminSaveState } from './AdminPendingSave.jsx';
import { AdminLoadingState } from './adminChrome.jsx';
import { KNOWN_FEATURE_KEYS } from 'shared/config';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { FEATURE_CHOICES } from '../featureChoices.js';
import { CheckboxField, Notice, SaveStatus } from './formControls.jsx';

/** Uses the same operator-only, whole-document save as the Features page. */
export default function FeatureSwitch({ featureKeys }) {
  const { isOperator } = useAuth();
  const { features, sources } = useEventConfig();
  const call = useAdminApi();
  const { action: saving, set: setSaving, begin: beginSave, capture: captureUnconfirmed, unconfirmed } = useAdminSaveState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [awaiting, setAwaiting] = useState(null);
  const ready = sources?.features === 'live';

  useEffect(() => {
    if (awaiting && (features?.[awaiting.key] === true) === awaiting.enabled) setAwaiting(null);
  }, [features, awaiting]);

  async function change(featureKey, checked) {
    if (!isOperator || !ready || awaiting || !beginSave(true)) return;
    setError('');
    setSaved('');
    const next = Object.fromEntries(KNOWN_FEATURE_KEYS.map((key) => [key, features?.[key] === true]));
    next[featureKey] = checked;
    try {
      await call('updateFeatures', { features: next });
      setAwaiting({ key: featureKey, enabled: checked });
      setSaved(`${FEATURE_CHOICES[featureKey].label} setting saved.`);
    } catch (err) {
      if (captureUnconfirmed(err)) return;
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-xs">
      {featureKeys.map((key) => {
        const label = FEATURE_CHOICES[key].label;
        const enabled = features?.[key] === true;
        return isOperator ? (
          <CheckboxField
            key={key}
            role="switch"
            name={key}
            label={label}
            checked={enabled}
            onChange={(checked) => change(key, checked)}
            disabled={!ready || saving || unconfirmed || Boolean(awaiting)}
            aria-busy={saving || undefined}
            hint={saving ? 'Saving the setting…' : !ready || awaiting ? 'Waiting for the current settings…' : 'Changes save immediately.'}
          />
        ) : (
          <p key={key} className="text-admin-sm text-admin-ink-secondary">{label}: {enabled ? 'On' : 'Off'}. Only an operator can change this setting.</p>
        );
      })}
      <AdminPendingSave busy={saving} unconfirmed={unconfirmed} to="/admin/features" />
      {isOperator && (!ready || awaiting) ? <AdminLoadingState recover quiet label="Loading the current settings…" /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {saved ? <SaveStatus message={saved} /> : null}
    </div>
  );
}
