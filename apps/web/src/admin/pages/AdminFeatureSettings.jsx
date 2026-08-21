// Feature flags (issue #14), wired to updateFeatures.
//
// config/features is a WHOLE-DOC replace and an omitted flag means disabled
// (spec §2.2), so this form always sends every known key — the key list comes
// from the shared schema (KNOWN_FEATURE_KEYS), which is the same list the
// server validates against, so a new flag appears here the moment it is added
// there.
import { useEffect, useMemo, useRef, useState } from 'react';
import { KNOWN_FEATURE_KEYS } from 'shared/config';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  CheckboxField,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  primaryButtonClass,
} from '../components/formControls.jsx';

/** Flag id → the sentence an operator needs to decide. */
const FEATURE_HINTS = {
  schedule: 'Show the public schedule.',
  speakers: 'Show the public speaker directory.',
  sponsors: 'Show the public sponsor list.',
  attendeeDirectory: 'Let signed-in attendees browse each other.',
  sessionBookmarks: 'Let attendees bookmark sessions.',
  sessionReactions: 'Let attendees react to sessions.',
  sessionMaterials: 'Publish slides and handouts on sessions.',
  badges: 'Enable attendee badges.',
  liveUpdates: 'Show the live updates feed during the event.',
  feedbackInbox: 'Collect attendee feedback.',
  schedulePdf: 'Offer the schedule as a PDF.',
  icsExport: 'Offer calendar (.ics) export.',
  updates: 'Publish written updates.',
  autoApproveTicketHolders: 'Approve ticket holders without review.',
  publicAttendeeProfiles: 'Make attendee profiles publicly visible.',
};

/** Every known flag, defaulted off, overlaid with what is configured now. */
function toForm(features) {
  const out = {};
  for (const key of KNOWN_FEATURE_KEYS) out[key] = features?.[key] === true;
  return out;
}

export default function AdminFeatureSettings() {
  const { features, source } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [form, setForm] = useState(() => toForm(features));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const adoptedRef = useRef(source === 'live');

  useEffect(() => {
    if (adoptedRef.current || source !== 'live') return;
    adoptedRef.current = true;
    setForm(toForm(features));
  }, [source, features]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      await call('updateFeatures', { features: form });
      setStatus('Saved. The site picks the change up live.');
      showToast('Feature flags saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Features</h1>
        <p className="text-sm text-brand-ink-muted">
          What the site offers. Turning a feature off hides its route as well as
          its navigation.
        </p>
      </div>

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          {KNOWN_FEATURE_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <CheckboxField
                label={key}
                checked={form[key]}
                hint={FEATURE_HINTS[key]}
                onChange={(checked) => setForm((c) => ({ ...c, [key]: checked }))}
              />
              {fieldErrors.get(`features.${key}`) ? (
                <p className="text-sm text-danger">{fieldErrors.get(`features.${key}`)}</p>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <div>
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save features'}
        </button>
      </div>
    </form>
  );
}
