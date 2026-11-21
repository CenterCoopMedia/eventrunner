// Feature flags (issue #14), wired to updateFeatures.
//
// The editor sends only changed flags. The shared schema supplies the flag
// list. The attendee feed has no switch until SOCIAL_FEED_RELEASED (#507).
import AdminPendingSave, { useAdminSaveState } from '../components/AdminPendingSave.jsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { KNOWN_FEATURE_KEYS, validateFeatures } from 'shared/config';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { applySettingsChanges, settingsChanges, settingsConflict } from '../settingsChanges.js';
import { useSavedMessage } from '../useSavedMessage.js';
import {
  FieldError,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  primaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { StatusBadge } from '../components/adminChrome.jsx';
import { contentError } from '../contentError.js';
import { FEATURE_CHOICES } from '../featureChoices.js';
import { SOCIAL_FEED_RELEASED } from '../socialFeedRelease.js';
import '../components/featureSwitch.css';
import BusyLabel from '../../components/BusyLabel.jsx';


const FEATURE_GROUPS = [
  {
    title: 'Public content',
    description: 'The event information visitors can explore.',
    keys: ['schedule', 'speakers', 'sponsors', 'updates', 'liveUpdates'],
  },
  {
    title: 'Attendees and access',
    description: 'Profiles, badges, and how ticket holders are approved.',
    keys: ['attendeeDirectory', 'socialFeed', 'publicAttendeeProfiles', 'badges', 'customBadges', 'autoApproveTicketHolders'],
  },
  {
    title: 'Session tools',
    description: 'Ways to save sessions, share materials, and use the schedule.',
    keys: ['sessionBookmarks', 'sessionReactions', 'sessionMaterials', 'schedulePdf', 'icsExport', 'calendarSync'],
  },
  {
    title: 'Feedback and browser tools',
    description: 'Feedback, change requests, and connected tools.',
    keys: ['feedbackInbox', 'changeRequests', 'coreWebVitals', 'webmcpPublic', 'webmcpAdmin'],
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

/** The flags this page offers: every schema key, less the feed until it is released. */
const VISIBLE_KEYS = KNOWN_FEATURE_KEYS.filter((key) => SOCIAL_FEED_RELEASED || key !== 'socialFeed');
const VISIBLE_GROUPS = featureGroupsFor(VISIBLE_KEYS);

function FeatureChoice({ featureKey, checked, onChange, error }) {
  const id = useId();
  const choice = FEATURE_CHOICES[featureKey] ?? {
    label: 'Additional feature',
    hint: 'Make this feature available on your event site.',
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
          role="switch"
          className="admin-feature-switch mt-3xs"
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
              {checked ? 'On' : 'Off'}
            </StatusBadge>
          </span>
          <span id={descriptionId} className="admin-feature-card__description">{featureKey === 'webmcpPublic' ? 'Let connected tools read public event information.' : featureKey === 'webmcpAdmin' ? 'Let connected tools check event setup after an admin signs in.' : choice.hint}</span>
        </span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** The resolved Boolean value of every known flag. */
function toForm(features) {
  const out = {};
  for (const key of KNOWN_FEATURE_KEYS) out[key] = features?.[key] === true;
  return out;
}

export default function AdminFeatureSettings() {
  const { features, liveFeatures, sources } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [form, setForm] = useState(() => toForm(features));
  const [error, setError] = useState(null);
  const { action: saving, set: setSaving, begin: beginSave, capture: captureUnconfirmed, unconfirmed: unconfirmedSave } = useAdminSaveState(false);
  const [status, setStatus] = useSavedMessage(form);
  const errorRef = useRef(null);
  const adoptedRef = useRef(sources.features === 'live');
  const baseline = useRef({ form, stored: liveFeatures ?? features });

  useEffect(() => {
    if (adoptedRef.current || sources.features !== 'live') return;
    adoptedRef.current = true;
    if (form !== baseline.current.form) return;
    const adopted = toForm(features);
    baseline.current = { form: adopted, stored: liveFeatures ?? features };
    setForm(adopted);
  }, [sources.features, features, liveFeatures, form]);

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
    if (saving) return;
    const loaded = baseline.current;
    const edit = settingsChanges(loaded.form, form, loaded.stored);
    const validation = validateFeatures({ ...toForm(features), ...edit.changes });
    if (!validation.ok) {
      setError({
        clientValidation: true,
        message: 'Check the feature settings before saving.',
        fieldErrors: validation.errors.map((message) => {
          const separator = message.indexOf(':');
          return { field: message.slice(0, separator), message: message.slice(separator + 2) };
        }),
      });
      return;
    }
    if (!beginSave(true)) return;
    setError(null);
    setStatus('');
    try {
      await call('updateFeatures', { features: edit });
      if (baseline.current === loaded) {
        baseline.current = { form, stored: applySettingsChanges(loaded.stored, edit.changes) };
      }
      setStatus('Features saved.');
      showToast('Features saved.', { announce: false });
    } catch (err) {
      if (captureUnconfirmed(err)) return;
      const labels = Object.fromEntries(KNOWN_FEATURE_KEYS.map((key) => [`features.${key}`, FEATURE_CHOICES[key]?.label ?? 'This feature']));
      setError(settingsConflict(err, labels)
        ?? contentError(err, { labels, fallback: 'Features could not be saved. Try again.' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title="Features"
        description="Choose what visitors can use on your event site."
        actions={
          <button type="submit" className={primaryButtonClass} aria-disabled={saving || unconfirmedSave || undefined} aria-busy={saving || undefined}>
            <BusyLabel busy={saving} pending="Saving features…">Save</BusyLabel>
          </button>
        }
      />

      <AdminPendingSave busy={saving} unconfirmed={unconfirmedSave} />
      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <p className="text-admin-sm text-admin-ink-secondary">
        {VISIBLE_KEYS.filter((key) => form[key]).length} of {VISIBLE_KEYS.length} features on.
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
                {group.keys.filter((key) => form[key]).length} of {group.keys.length} on
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
