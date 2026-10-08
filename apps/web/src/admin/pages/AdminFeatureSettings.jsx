// Feature flags (issue #14), wired to updateFeatures.
//
// config/features is a WHOLE-DOC replace and an omitted flag means disabled
// (spec §2.2), so this form always sends every known key — the key list comes
// from the shared schema (KNOWN_FEATURE_KEYS), which is the same list the
// server validates against, so a new flag appears here the moment it is added
// there.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { KNOWN_FEATURE_KEYS } from 'shared/config';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  FieldError,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  primaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { StatusBadge } from '../components/adminChrome.jsx';

/** Human-readable choices; the stored keys and whole-document payload stay unchanged. */
const FEATURE_CHOICES = {
  schedule: { label: 'Public schedule', hint: 'Show the public schedule.' },
  speakers: { label: 'Speaker directory', hint: 'Show the public speaker directory.' },
  sponsors: { label: 'Sponsor list', hint: 'Show the public sponsor list.' },
  attendeeDirectory: { label: 'Attendee directory', hint: 'Let signed-in attendees browse each other.' },
  sessionBookmarks: { label: 'Session bookmarks', hint: 'Let attendees bookmark sessions.' },
  sessionReactions: { label: 'Session reactions', hint: 'Let attendees react to sessions.' },
  sessionMaterials: { label: 'Session materials', hint: 'Publish slides and handouts on sessions.' },
  badges: { label: 'Attendee badges', hint: 'Enable attendee badges.' },
  customBadges: { label: 'Custom badges', hint: 'Let attendees create their own profile badges.' },
  liveUpdates: { label: 'Live updates', hint: 'Show the live updates feed during the event.' },
  feedbackInbox: { label: 'Feedback inbox', hint: 'Collect attendee feedback.' },
  schedulePdf: { label: 'Schedule PDF', hint: 'Offer the schedule as a PDF.' },
  icsExport: { label: 'Calendar export', hint: 'Offer calendar (.ics) export.' },
  calendarSync: { label: 'Calendar sync', hint: 'Let attendees sync bookmarked sessions to their calendar.' },
  updates: { label: 'Written updates', hint: 'Publish written updates.' },
  autoApproveTicketHolders: { label: 'Automatic ticket approval', hint: 'Approve ticket holders without review.' },
  publicAttendeeProfiles: { label: 'Public attendee profiles', hint: 'Make attendee profiles publicly visible.' },
  webmcpPublic: { label: 'Public browser tools', hint: 'Expose bounded public read-only site tools in supported browsers.' },
  webmcpAdmin: { label: 'Admin browser tools', hint: 'Expose authenticated read-only admin diagnostics in supported browsers.' },
  changeRequests: { label: 'Change requests', hint: 'Let signed-in visitors and staff send change requests.' },
};

const FEATURE_GROUPS = [
  {
    title: 'Public content',
    description: 'The event information visitors can explore.',
    keys: ['schedule', 'speakers', 'sponsors', 'updates', 'liveUpdates'],
  },
  {
    title: 'Attendees and access',
    description: 'Profiles, badges, and how ticket holders are approved.',
    keys: ['attendeeDirectory', 'publicAttendeeProfiles', 'badges', 'customBadges', 'autoApproveTicketHolders'],
  },
  {
    title: 'Session tools',
    description: 'Ways to save sessions, share materials, and use the schedule.',
    keys: ['sessionBookmarks', 'sessionReactions', 'sessionMaterials', 'schedulePdf', 'icsExport', 'calendarSync'],
  },
  {
    title: 'Feedback and browser tools',
    description: 'Requests from visitors and read-only tools for supported browsers.',
    keys: ['feedbackInbox', 'changeRequests', 'webmcpPublic', 'webmcpAdmin'],
  },
];

/** Keep every schema key visible, including features added before their UI copy. */
export function featureGroupsFor(featureKeys) {
  const groupedKeys = new Set(FEATURE_GROUPS.flatMap((group) => group.keys));
  const ungroupedKeys = featureKeys.filter((key) => !groupedKeys.has(key));
  return [
    ...FEATURE_GROUPS.map((group) => ({
      ...group,
      keys: group.keys.filter((key) => featureKeys.includes(key)),
    })),
    ...(ungroupedKeys.length ? [{ title: 'Other features', keys: ungroupedKeys }] : []),
  ].filter((group) => group.keys.length > 0);
}

const VISIBLE_GROUPS = featureGroupsFor(KNOWN_FEATURE_KEYS);

function FeatureChoice({ featureKey, checked, onChange, error }) {
  const id = useId();
  const choice = FEATURE_CHOICES[featureKey] ?? {
    label: featureKey.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase()),
    hint: 'Enable this feature for the event.',
  };
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  return (
    <div className="admin-feature-card" data-feature-key={featureKey} data-enabled={checked} data-invalid={Boolean(error)}>
      <label htmlFor={id} className="admin-feature-card__label">
        <input
          id={id}
          name={featureKey}
          type="checkbox"
          className="mt-3xs h-5 w-5 shrink-0 rounded-admin-small border-admin-rule-control bg-admin-ground-input accent-admin-action"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-labelledby={titleId}
          aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ''}`}
          aria-invalid={error ? 'true' : undefined}
        />
        <span className="admin-feature-card__content">
          <span className="admin-feature-card__heading">
            <span id={titleId} className="admin-feature-card__title">{choice.label}</span>
            <StatusBadge className="admin-feature-card__state" tone={checked ? 'ok' : 'neutral'} aria-hidden="true">
              {checked ? 'Enabled' : 'Disabled'}
            </StatusBadge>
          </span>
          <span id={descriptionId} className="admin-feature-card__description">{choice.hint}</span>
        </span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

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
        actions={
          <button type="submit" className={primaryButtonClass} disabled={saving}>
            {saving ? 'Saving…' : 'Save features'}
          </button>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <p className="text-admin-sm text-admin-ink-secondary">
        {KNOWN_FEATURE_KEYS.filter((key) => form[key]).length} of {KNOWN_FEATURE_KEYS.length} features enabled.
        {' '}Changes take effect after you save.
      </p>

      <div className="admin-feature-groups">
        {VISIBLE_GROUPS.map((group) => (
          <Panel
            key={group.title}
            title={group.title}
            description={group.description}
            className="admin-feature-group"
            actions={
              <StatusBadge>
                {group.keys.filter((key) => form[key]).length} of {group.keys.length} enabled
              </StatusBadge>
            }
          >
            <div className="admin-feature-grid">
              {group.keys.map((key) => (
                <FeatureChoice
                  key={key}
                  featureKey={key}
                  checked={form[key]}
                  onChange={(checked) => setForm((current) => ({ ...current, [key]: checked }))}
                  error={fieldErrors.get(`features.${key}`)}
                />
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </form>
  );
}
