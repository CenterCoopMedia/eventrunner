// Event settings (issue #14): the config/event fields an admin owns, wired to
// updateEventConfig.
//
// Contract notes that shape this form (functions/src/admin/config.cjs):
//   • config/event is MERGE-then-validate, so this form may send only the
//     keys it edits — untouched keys (legal.postalAddressHtml, seo, …) are
//     preserved by the server's deep merge.
//   • Tier A deploy mirrors (slug, project id, region, providers, …) are
//     read-only and rejected BY NAME, so they are not fields here.
//   • sender.domainVerified / domainVerifiedAt belong to the sender-domain
//     verification job alone; the form shows the current state read-only and
//     never sends it.
//   • Current values come from EventConfigContext, whose onSnapshot listener
//     also delivers the saved result back — no reload, nothing optimistic.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  Panel,
  SaveStatus,
  ServerErrorSummary,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader from '../components/adminChrome.jsx';

const blankDay = () => ({ id: '', label: '', date: '', startTime: '', endTime: '' });
const blankTrack = () => ({ letter: '', name: '' });

/** Editable slice of config/event, normalized for controlled inputs. */
function toForm(eventConfig) {
  const c = eventConfig ?? {};
  const venue = c.venue ?? {};
  const sender = c.sender ?? {};
  const registration = c.registration ?? {};
  const legal = c.legal ?? {};
  const seo = c.seo ?? {};
  const social = c.social ?? {};
  return {
    name: c.name ?? '',
    shortName: c.shortName ?? '',
    tagline: c.tagline ?? '',
    timezone: c.timezone ?? '',
    days: Array.isArray(c.days)
      ? c.days.map((day) => ({
          id: day?.id ?? '',
          label: day?.label ?? '',
          date: day?.date ?? '',
          startTime: day?.startTime ?? '',
          endTime: day?.endTime ?? '',
        }))
      : [],
    tracks: Array.isArray(c.tracks)
      ? c.tracks.map((track) => ({ letter: track?.letter ?? '', name: track?.name ?? '' }))
      : [],
    venue: {
      name: venue.name ?? '',
      addressLine1: venue.addressLine1 ?? '',
      addressLine2: venue.addressLine2 ?? '',
      city: venue.city ?? '',
      region: venue.region ?? '',
      postalCode: venue.postalCode ?? '',
      country: venue.country ?? '',
      mapUrl: venue.mapUrl ?? '',
    },
    sender: {
      email: sender.email ?? '',
      name: sender.name ?? '',
      replyTo: sender.replyTo ?? '',
    },
    registration: {
      opensAt: registration.opensAt ?? '',
      closesAt: registration.closesAt ?? '',
      externalUrl: registration.externalUrl ?? '',
    },
    legal: {
      operatorName: legal.operatorName ?? '',
      supportEmail: legal.supportEmail ?? '',
      conductEmail: legal.conductEmail ?? '',
    },
    seo: {
      description: seo.description ?? '',
      organizerName: seo.organizerName ?? '',
      organizerUrl: seo.organizerUrl ?? '',
    },
    social: { hashtag: social.hashtag ?? '' },
  };
}

/** Blank optional strings are sent as null — the server's "clear this" form. */
const orNull = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' || trimmed === undefined ? null : trimmed;
};

function toPayload(form) {
  return {
    name: form.name,
    shortName: form.shortName,
    tagline: orNull(form.tagline),
    timezone: form.timezone,
    days: form.days.map((day) => ({
      id: day.id,
      label: day.label,
      date: day.date,
      startTime: day.startTime,
      endTime: day.endTime,
    })),
    // A letter is a wayfinding mark, so it is always sent as a capital —
    // the server accepts A-Z only, and an operator should not have to know
    // that to type one.
    tracks: form.tracks.map((track) => ({
      letter: String(track.letter ?? '').trim().toUpperCase(),
      name: track.name,
    })),
    venue: {
      name: orNull(form.venue.name),
      addressLine1: orNull(form.venue.addressLine1),
      addressLine2: orNull(form.venue.addressLine2),
      city: orNull(form.venue.city),
      region: orNull(form.venue.region),
      postalCode: orNull(form.venue.postalCode),
      country: orNull(form.venue.country),
      mapUrl: orNull(form.venue.mapUrl),
    },
    sender: {
      email: form.sender.email,
      name: orNull(form.sender.name),
      replyTo: orNull(form.sender.replyTo),
    },
    registration: {
      opensAt: orNull(form.registration.opensAt),
      closesAt: orNull(form.registration.closesAt),
      externalUrl: orNull(form.registration.externalUrl),
    },
    legal: {
      operatorName: orNull(form.legal.operatorName),
      supportEmail: orNull(form.legal.supportEmail),
      conductEmail: orNull(form.legal.conductEmail),
    },
    seo: {
      description: orNull(form.seo.description),
      organizerName: orNull(form.seo.organizerName),
      organizerUrl: orNull(form.seo.organizerUrl),
    },
    social: { hashtag: orNull(form.social.hashtag) },
  };
}

export default function AdminEventSettings() {
  const { eventConfig, sources } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [form, setForm] = useState(() => toForm(eventConfig));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  // Adopt runtime config once CONFIG/EVENT itself arrives (the snapshot
  // renders first), then stop — later listener echoes must not overwrite
  // in-progress edits. Keyed on this document's own readiness, not the
  // aggregate `source`: a sibling doc (theme, badges) reporting first would
  // otherwise freeze the form on snapshot values, and this form's save is a
  // merge over the stored doc — seeded-from-snapshot values would overwrite
  // production ones field by field.
  const adoptedRef = useRef(sources.event === 'live');

  useEffect(() => {
    if (adoptedRef.current || sources.event !== 'live') return;
    adoptedRef.current = true;
    setForm(toForm(eventConfig));
  }, [sources.event, eventConfig]);

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
  const errorFor = (field) => fieldErrors.get(field);

  const setGroup = (group, patch) =>
    setForm((current) => ({ ...current, [group]: { ...current[group], ...patch } }));
  const setDay = (index, patch) =>
    setForm((current) => ({
      ...current,
      days: current.days.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    }));
  const setTrack = (index, patch) =>
    setForm((current) => ({
      ...current,
      tracks: current.tracks.map((track, i) => (i === index ? { ...track, ...patch } : track)),
    }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      await call('updateEventConfig', { event: toPayload(form) });
      setStatus('Saved. The site picks the change up live.');
      showToast('Event settings saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const verified = eventConfig?.sender?.domainVerified === true;

  return (
    <form className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title="Event"
        description="Name, dates, venue, and the addresses the site and its email use."
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Identity">
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Event name"
            value={form.name}
            onChange={(value) => setForm((c) => ({ ...c, name: value }))}
            error={errorFor('name')}
          />
          <TextField
            label="Short name"
            value={form.shortName}
            onChange={(value) => setForm((c) => ({ ...c, shortName: value }))}
            error={errorFor('shortName')}
            hint="Used in the header and in email subjects."
          />
          <div className="sm:col-span-2">
            <TextField
              label="Tagline"
              value={form.tagline}
              onChange={(value) => setForm((c) => ({ ...c, tagline: value }))}
              error={errorFor('tagline')}
            />
          </div>
          <TextField
            label="Timezone"
            value={form.timezone}
            onChange={(value) => setForm((c) => ({ ...c, timezone: value }))}
            error={errorFor('timezone')}
            hint="An IANA timezone name, e.g. America/New_York."
          />
        </div>
      </Panel>

      <Panel
        title="Days"
        description="Listed in ascending date order; each day needs an id, a date, and start/end times."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setForm((c) => ({ ...c, days: [...c.days, blankDay()] }))}
          >
            Add day
          </button>
        }
      >
        {form.days.length === 0 ? (
          <p className="text-caption text-admin-ink-secondary">No days configured yet.</p>
        ) : (
          <ol className="flex flex-col">
            {form.days.map((day, index) => (
              <li
                key={index}
                className="border-admin-rule-hairline border-t-admin-hairline pt-sm mt-sm first:border-t-0 first:pt-0 first:mt-0"
              >
                <div className="grid gap-sm sm:grid-cols-2">
                  <TextField
                    label={`Day ${index + 1} id`}
                    value={day.id}
                    onChange={(value) => setDay(index, { id: value })}
                    error={errorFor(`days[${index}].id`)}
                  />
                  <TextField
                    label={`Day ${index + 1} label`}
                    value={day.label}
                    onChange={(value) => setDay(index, { label: value })}
                    error={errorFor(`days[${index}].label`)}
                  />
                  <TextField
                    label={`Day ${index + 1} date`}
                    type="date"
                    value={day.date}
                    onChange={(value) => setDay(index, { date: value })}
                    error={errorFor(`days[${index}].date`) ?? errorFor(`days[${index}]`)}
                  />
                  <div className="grid grid-cols-2 gap-sm">
                    <TextField
                      label={`Day ${index + 1} start`}
                      type="time"
                      value={day.startTime}
                      onChange={(value) => setDay(index, { startTime: value })}
                      error={errorFor(`days[${index}].startTime`)}
                    />
                    <TextField
                      label={`Day ${index + 1} end`}
                      type="time"
                      value={day.endTime}
                      onChange={(value) => setDay(index, { endTime: value })}
                      error={errorFor(`days[${index}].endTime`)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className={`${dangerButtonClass} mt-sm`}
                  onClick={() =>
                    setForm((c) => ({ ...c, days: c.days.filter((_, i) => i !== index) }))
                  }
                >
                  Remove day {index + 1}
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        title="Tracks"
        description="Sessions that run at the same time, on separate lines. Each line has a letter and a name, and the schedule shows both. Leave this empty if everything happens in one room."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setForm((c) => ({ ...c, tracks: [...c.tracks, blankTrack()] }))}
          >
            Add track
          </button>
        }
      >
        {form.tracks.length === 0 ? (
          <p className="text-caption text-admin-ink-secondary">No tracks configured yet.</p>
        ) : (
          <ol className="flex flex-col">
            {form.tracks.map((track, index) => (
              <li
                key={index}
                className="border-admin-rule-hairline border-t-admin-hairline pt-sm mt-sm first:border-t-0 first:pt-0 first:mt-0"
              >
                <div className="grid gap-sm sm:grid-cols-2">
                  <TextField
                    label={`Track ${index + 1} letter`}
                    value={track.letter}
                    onChange={(value) => setTrack(index, { letter: value })}
                    error={errorFor(`tracks[${index}].letter`)}
                    maxLength={1}
                    hint="One letter, A to Z. It is how a reader tells the lines apart."
                  />
                  <TextField
                    label={`Track ${index + 1} name`}
                    value={track.name}
                    onChange={(value) => setTrack(index, { name: value })}
                    error={errorFor(`tracks[${index}].name`)}
                    hint="Shown beside the letter, e.g. Practice."
                  />
                </div>
                <button
                  type="button"
                  className={`${dangerButtonClass} mt-sm`}
                  onClick={() =>
                    setForm((c) => ({ ...c, tracks: c.tracks.filter((_, i) => i !== index) }))
                  }
                >
                  Remove track {index + 1}
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Venue">
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Venue name"
            value={form.venue.name}
            onChange={(value) => setGroup('venue', { name: value })}
            error={errorFor('venue.name')}
          />
          <TextField
            label="Address line 1"
            value={form.venue.addressLine1}
            onChange={(value) => setGroup('venue', { addressLine1: value })}
          />
          <TextField
            label="Address line 2"
            value={form.venue.addressLine2}
            onChange={(value) => setGroup('venue', { addressLine2: value })}
          />
          <TextField
            label="City"
            value={form.venue.city}
            onChange={(value) => setGroup('venue', { city: value })}
          />
          <TextField
            label="Region"
            value={form.venue.region}
            onChange={(value) => setGroup('venue', { region: value })}
          />
          <TextField
            label="Postal code"
            value={form.venue.postalCode}
            onChange={(value) => setGroup('venue', { postalCode: value })}
          />
          <TextField
            label="Country"
            value={form.venue.country}
            onChange={(value) => setGroup('venue', { country: value })}
          />
          <TextField
            label="Map URL"
            value={form.venue.mapUrl}
            onChange={(value) => setGroup('venue', { mapUrl: value })}
          />
        </div>
      </Panel>

      <Panel
        title="Registration"
        description="Naive local datetimes (YYYY-MM-DDTHH:MM) in the event’s timezone."
      >
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Registration opens"
            type="datetime-local"
            value={form.registration.opensAt}
            onChange={(value) => setGroup('registration', { opensAt: value })}
            error={errorFor('registration.opensAt') ?? errorFor('registration')}
          />
          <TextField
            label="Registration closes"
            type="datetime-local"
            value={form.registration.closesAt}
            onChange={(value) => setGroup('registration', { closesAt: value })}
            error={errorFor('registration.closesAt')}
          />
          <div className="sm:col-span-2">
            <TextField
              label="External registration URL"
              value={form.registration.externalUrl}
              onChange={(value) => setGroup('registration', { externalUrl: value })}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Sender"
        description="The From address every transactional email uses."
      >
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Sender email"
            type="email"
            value={form.sender.email}
            onChange={(value) => setGroup('sender', { email: value })}
            error={errorFor('sender.email')}
          />
          <TextField
            label="Sender name"
            value={form.sender.name}
            onChange={(value) => setGroup('sender', { name: value })}
            error={errorFor('sender.name')}
          />
          <TextField
            label="Reply-to"
            type="email"
            value={form.sender.replyTo}
            onChange={(value) => setGroup('sender', { replyTo: value })}
            error={errorFor('sender.replyTo')}
          />
          <p className="self-center text-caption text-admin-ink-secondary">
            Sender domain:{' '}
            <strong
              className={`font-admin-data font-semibold ${
                verified ? 'text-admin-state-ok' : 'text-admin-state-caution'
              }`}
            >
              {verified ? 'verified' : 'not verified'}
            </strong>
            . Verification is set by the sender-domain job, not from here.
          </p>
        </div>
      </Panel>

      <Panel title="Operator and search">
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Operator name"
            value={form.legal.operatorName}
            onChange={(value) => setGroup('legal', { operatorName: value })}
          />
          <TextField
            label="Support email"
            type="email"
            value={form.legal.supportEmail}
            onChange={(value) => setGroup('legal', { supportEmail: value })}
          />
          <TextField
            label="Conduct email"
            type="email"
            value={form.legal.conductEmail}
            onChange={(value) => setGroup('legal', { conductEmail: value })}
          />
          <TextField
            label="Social hashtag"
            value={form.social.hashtag}
            onChange={(value) => setGroup('social', { hashtag: value })}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Search description"
              value={form.seo.description}
              onChange={(value) => setGroup('seo', { description: value })}
            />
          </div>
          <TextField
            label="Organizer name"
            value={form.seo.organizerName}
            onChange={(value) => setGroup('seo', { organizerName: value })}
          />
          <TextField
            label="Organizer URL"
            value={form.seo.organizerUrl}
            onChange={(value) => setGroup('seo', { organizerUrl: value })}
          />
        </div>
      </Panel>

      <div>
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save event settings'}
        </button>
      </div>
    </form>
  );
}
