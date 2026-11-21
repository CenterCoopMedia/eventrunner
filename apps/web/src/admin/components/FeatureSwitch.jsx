import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { FEATURE_CHOICES } from '../featureChoices.js';
import { settingsConflict } from '../settingsChanges.js';
import { CheckboxField, Notice, SaveStatus } from './formControls.jsx';

/** Uses the same operator-only save as the Features page. */
export default function FeatureSwitch({ featureKeys }) {
  const { isOperator } = useAuth();
  const { features, liveFeatures, sources } = useEventConfig();
  const call = useAdminApi();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [awaiting, setAwaiting] = useState(null);
  const ready = sources?.features === 'live';

  useEffect(() => {
    if (awaiting && (features?.[awaiting.key] === true) === awaiting.enabled) setAwaiting(null);
  }, [features, awaiting]);

  async function change(featureKey, checked) {
    if (!isOperator || !ready || pending.current || awaiting) return;
    pending.current = true;
    setSaving(true);
    setError('');
    setSaved('');
    try {
      await call('updateFeatures', {
        features: {
          changes: { [featureKey]: checked },
          expected: { [featureKey]: (liveFeatures ?? features)?.[featureKey] ?? null },
        },
      });
      setAwaiting({ key: featureKey, enabled: checked });
      setSaved(`${FEATURE_CHOICES[featureKey].label} setting saved.`);
    } catch (err) {
      setError(settingsConflict(err, { [`features.${featureKey}`]: FEATURE_CHOICES[featureKey].label })?.message ?? err.message);
    } finally {
      pending.current = false;
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
            disabled={!ready || saving || Boolean(awaiting)}
            aria-busy={saving || undefined}
            hint={saving ? 'Saving the setting…' : !ready || awaiting ? 'Waiting for the current settings…' : 'Changes save immediately.'}
          />
        ) : (
          <p key={key} className="text-admin-sm text-admin-ink-secondary">{label}: {enabled ? 'On' : 'Off'}. Only an operator can change this setting.</p>
        );
      })}
      {error ? <Notice tone="error" message={error} /> : null}
      {saved ? <SaveStatus message={saved} /> : null}
    </div>
  );
}
