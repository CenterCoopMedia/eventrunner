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
  FieldError,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  primaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader from '../components/adminChrome.jsx';

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
  webmcpPublic: 'Expose bounded public read-only site tools in supported browsers.',
  webmcpAdmin: 'Expose authenticated read-only admin diagnostics in supported browsers.',
};

/** Every known flag, defaulted off, overlaid with what is configured now. */
function toForm(features) {
  const out = {};
  for (const key of KNOWN_FEATURE_KEYS) out[key] = features?.[key] === true;
  return out;
}

export default function AdminFeatureSettings() {
  const { features, sources } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [form, setForm] = useState(() => toForm(features));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  // Keyed on CONFIG/FEATURES' own readiness. The aggregate `source` flips as
  // soon as any config doc reports, so seeding on it would let a config/event
  // snapshot arriving first freeze this form on the build-time flags — and
  // config/features is a whole-doc replace, so saving that would silently
  // revert every production flag.
  const adoptedRef = useRef(sources.features === 'live');

  useEffect(() => {
    if (adoptedRef.current || sources.features !== 'live') return;
    adoptedRef.current = true;
    setForm(toForm(features));
  }, [sources.features, features]);

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
    <form className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title="Features"
        description="What the site offers. Turning a feature off hides its route as well as its navigation."
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel>
        <div className="grid gap-sm sm:grid-cols-2">
          {KNOWN_FEATURE_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-3xs">
              <CheckboxField
                label={key}
                checked={form[key]}
                hint={FEATURE_HINTS[key]}
                onChange={(checked) => setForm((c) => ({ ...c, [key]: checked }))}
              />
              <FieldError message={fieldErrors.get(`features.${key}`)} />
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
