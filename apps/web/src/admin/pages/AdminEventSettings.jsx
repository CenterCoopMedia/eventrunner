// Event settings (issue #14): the config/event fields an admin owns, wired to
// updateEventConfig.
//
// Contract notes that shape this form (functions/src/admin/config.cjs):
//   • config/event is MERGE-then-validate, so this form may send only the
//     keys it edits — untouched keys (legal.postalAddressHtml, seo, …) are
//     preserved by the server's deep merge.
//   • Tier A deploy mirrors (slug, project id, region, providers, …) are
//     read-only and rejected BY NAME, so they are not fields here.
//   • sender.domainVerified, domainVerifiedAt, and domainVerifiedDomain belong
//     to the sender-domain job. The badge uses the same check as launch
//     readiness. The form shows that state read-only and never sends it.
//   • Current values come from EventConfigContext, whose onSnapshot listener
//     also delivers the saved result back — no reload, nothing optimistic.
import { useEffect, useMemo, useRef, useState } from 'react';
import { senderDomainVerified } from 'shared/readiness';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  Panel,
  SaveStatus,
  ServerErrorSummary,
  TextField,
  primaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { StatusBadge } from '../components/adminChrome.jsx';
import { subscribeAdminCollection } from '../adminSource.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import VenueReferenceEditor, {
  normalizeVenueReferences,
  validateVenueMap,
  validateVenueReferences,
  venueReferencesPayload,
} from '../components/VenueReferenceEditor.jsx';
import SocialHandlesEditor, {
  normalizeSocialHandles,
  socialHandlesPayload,
  validateSocialHandles,
} from '../components/SocialHandlesEditor.jsx';
import MilestonesEditor, {
  milestonesPayload,
  normalizeMilestones,
  validateMilestoneRows,
} from '../components/MilestonesEditor.jsx';
import TimeZoneField from '../components/TimeZoneField.jsx';
import EventDaysEditor, { daysPayload, normalizeDays } from '../components/EventDaysEditor.jsx';
import EventTracksEditor, {
  markTracksSaved,
  normalizeTracks,
  tracksPayload,
} from '../components/EventTracksEditor.jsx';

/** Shared empty result, so a render with no errors is not a new Map. */
const NO_ERRORS = new Map();

/** Editable slice of config/event, normalized for controlled inputs. */
function toForm(eventConfig) {
  const c = eventConfig ?? {};
  const venue = c.venue ?? {};
  const sender = c.sender ?? {};
  const registration = c.registration ?? {};
  const legal = c.legal ?? {};
  const seo = c.seo ?? {};
  const social = c.social ?? {};
  const slideTemplate = c.speakerResources?.slideTemplate ?? {};
  return {
    name: c.name ?? '',
    shortName: c.shortName ?? '',
    tagline: c.tagline ?? '',
    timezone: c.timezone ?? '',
    days: normalizeDays(c.days),
    tracks: normalizeTracks(c.tracks),
    venue: {
      name: venue.name ?? '',
      addressLine1: venue.addressLine1 ?? '',
      addressLine2: venue.addressLine2 ?? '',
      city: venue.city ?? '',
      region: venue.region ?? '',
      postalCode: venue.postalCode ?? '',
      country: venue.country ?? '',
      mapUrl: venue.mapUrl ?? '',
      ...normalizeVenueReferences(venue),
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
      actionLabel: registration.actionLabel ?? '',
      goal: registration.goal == null ? '' : String(registration.goal),
    },
    milestones: normalizeMilestones(c.milestones),
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
    social: { hashtag: social.hashtag ?? '', handles: normalizeSocialHandles(social) },
    speakerResources: {
      slideTemplate: {
        label: slideTemplate.label ?? '',
        url: slideTemplate.url ?? '',
      },
    },
  };
}

/**
 * Session titles grouped by one reference a session carries (its day id,
 * its track letter), each title once.
 *
 * @param {object[]} sessions
 * @param {(session: object) => unknown} referenceOf
 * @returns {Map<string, string[]>}
 */
function sessionUsage(sessions, referenceOf) {
  const usage = new Map();
  for (const session of sessions) {
    const reference = referenceOf(session);
    if (typeof reference !== 'string' || !reference) continue;
    const rows = usage.get(reference) ?? [];
    const label = session.title || session.id;
    if (!rows.includes(label)) rows.push(label);
    usage.set(reference, rows);
  }
  return usage;
}

/** Blank optional strings are sent as null — the server's "clear this" form. */
const orNull = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' || trimmed === undefined ? null : trimmed;
};

/**
 * The registration goal as the server stores it: a number, or null when
 * the field is blank. Anything that is not a finite number goes as typed,
 * so the server refuses it by name and the field is marked. It is never
 * sent as NaN: JSON writes NaN as null, and null clears the goal.
 */
function goalPayload(value) {
  const typed = orNull(value);
  if (typed === null) return null;
  const number = Number(typed);
  return Number.isFinite(number) ? number : typed;
}

/**
 * The editable slice, shaped for updateEventConfig. `includeSender` is
 * false for a staff caller: the sender block is the operator's to change
 * (functions/src/admin/config.cjs), so staff neither edit it nor send it —
 * a save that carried it unchanged would go through, but a save that never
 * carries it cannot be refused for it either.
 */
function toPayload(form, { includeSender = true } = {}) {
  return {
    name: form.name,
    shortName: form.shortName,
    tagline: orNull(form.tagline),
    timezone: form.timezone,
    days: daysPayload(form.days),
    tracks: tracksPayload(form.tracks),
    venue: {
      name: orNull(form.venue.name),
      addressLine1: orNull(form.venue.addressLine1),
      addressLine2: orNull(form.venue.addressLine2),
      city: orNull(form.venue.city),
      region: orNull(form.venue.region),
      postalCode: orNull(form.venue.postalCode),
      country: orNull(form.venue.country),
      mapUrl: orNull(form.venue.mapUrl),
      ...venueReferencesPayload(form.venue),
    },
    ...(includeSender
      ? {
        sender: {
          email: form.sender.email,
          name: orNull(form.sender.name),
          replyTo: orNull(form.sender.replyTo),
        },
      }
      : {}),
    registration: {
      opensAt: orNull(form.registration.opensAt),
      closesAt: orNull(form.registration.closesAt),
      externalUrl: orNull(form.registration.externalUrl),
      actionLabel: orNull(form.registration.actionLabel),
      goal: goalPayload(form.registration.goal),
    },
    milestones: milestonesPayload(form.milestones),
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
    social: {
      hashtag: orNull(form.social.hashtag),
      handles: socialHandlesPayload(form.social.handles),
    },
    speakerResources: {
      slideTemplate:
        orNull(form.speakerResources.slideTemplate.label) === null
        && orNull(form.speakerResources.slideTemplate.url) === null
          ? null
          : {
            label: orNull(form.speakerResources.slideTemplate.label),
            url: orNull(form.speakerResources.slideTemplate.url),
          },
    },
  };
}

export default function AdminEventSettings() {
  const { eventConfig, sources } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();
  // The sender block is the operator's (issue #186): staff read it here and
  // never send it, so their save is never refused for a field they cannot
  // change. The server compares a sent sender against the stored one and
  // refuses only a CHANGE from staff; this is the client's half.
  const { adminTier } = useAuth();
  const canEditSender = adminTier === 'operator';

  const [form, setForm] = useState(() => toForm(eventConfig));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [liveSessions, setLiveSessions] = useState([]);
  const [draftSessions, setDraftSessions] = useState([]);
  const errorRef = useRef(null);
  // Submit reaches into the form to find the first field it marked invalid.
  const formRef = useRef(null);
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

  useEffect(() => {
    const unsubscribeLive = subscribeAdminCollection('cmsSchedule', setLiveSessions);
    const unsubscribeDrafts = subscribeAdminCollection('cmsSchedule_drafts', setDraftSessions);
    return () => {
      unsubscribeLive?.();
      unsubscribeDrafts?.();
    };
  }, []);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const localVenueErrors = useMemo(
    () => validateVenueReferences(form.venue),
    [form.venue],
  );
  // THE MAP IS CHECKED AT SUBMIT, NOT WHILE TYPING (issue #219). The places
  // and movements above mark their fields as they are typed; the map's
  // fields say nothing until a save is attempted, because until then there
  // is no map to be wrong about. Neither set disables the save control — a
  // dead button is a form telling somebody "no" without telling them which
  // field said it — so both are refused in submit instead. They clear
  // themselves as the fields are fixed, so nobody is arguing with a stale
  // message.
  const [mapChecked, setMapChecked] = useState(false);
  const mapErrors = useMemo(
    () => (mapChecked ? validateVenueMap(form.venue) : NO_ERRORS),
    [mapChecked, form.venue],
  );
  // The social accounts are checked at submit too, for the same reason: a
  // blank row just added has nothing to be wrong about until a save is
  // attempted. After a save lands the check is off again, so the next new
  // row starts quiet.
  const [socialChecked, setSocialChecked] = useState(false);
  const socialErrors = useMemo(
    () => (socialChecked ? validateSocialHandles(form.social.handles) : NO_ERRORS),
    [socialChecked, form.social.handles],
  );
  // The milestones are checked at submit as well (issue #180): a row just
  // added says nothing until a save is attempted.
  const [milestonesChecked, setMilestonesChecked] = useState(false);
  const milestoneErrors = useMemo(
    () => (milestonesChecked ? validateMilestoneRows(form.milestones) : NO_ERRORS),
    [milestonesChecked, form.milestones],
  );
  const errorFor = (field) =>
    localVenueErrors.get(field)
    ?? mapErrors.get(field)
    ?? socialErrors.get(field)
    ?? milestoneErrors.get(field)
    ?? fieldErrors.get(field);
  const placeUsage = useMemo(
    () => sessionUsage([...liveSessions, ...draftSessions], (session) => session.placeId),
    [liveSessions, draftSessions],
  );
  // The sessions on each day and in each track, live and draft, so a
  // removal can say what it does to them (issue #475).
  const dayUsage = useMemo(
    () => sessionUsage([...liveSessions, ...draftSessions], (session) => session.dayId),
    [liveSessions, draftSessions],
  );
  const trackUsage = useMemo(
    () => sessionUsage([...liveSessions, ...draftSessions], (session) => (
      typeof session.track === 'string' ? session.track.trim().toUpperCase() : ''
    )),
    [liveSessions, draftSessions],
  );

  const setGroup = (group, patch) =>
    setForm((current) => ({ ...current, [group]: { ...current[group], ...patch } }));
  const setSlideTemplate = (patch) =>
    setForm((current) => ({
      ...current,
      speakerResources: {
        ...current.speakerResources,
        slideTemplate: { ...current.speakerResources.slideTemplate, ...patch },
      },
    }));

  async function submit(event) {
    event.preventDefault();
    // Nothing is sent while the venue is wrong, and the person is put in
    // front of the field that is wrong rather than left to hunt for it.
    //
    // BOTH validators refuse here, for one reason each. The places and the
    // movements are checked as they are typed, so their fields are already
    // marked — but the save control stays live (interface guidelines: a
    // submit control is never disabled for a validation state), and without
    // this the marked form was still sent and the refusal came back from the
    // server a round trip later. The map is checked only from here, because
    // its fields say nothing until a save is attempted.
    setMapChecked(true);
    setSocialChecked(true);
    setMilestonesChecked(true);
    if (
      localVenueErrors.size > 0
      || validateVenueMap(form.venue).size > 0
      || validateSocialHandles(form.social.handles).size > 0
      || validateMilestoneRows(form.milestones).size > 0
    ) {
      setStatus('');
      // A rejection from the SERVER, if one is still standing, goes now.
      // Nothing is being sent, so its summary is stating a problem that may
      // already be fixed — and the focus move below lands on the first
      // marked field in the form, which would be one of that old
      // rejection's rather than the venue field doing the refusing.
      setError(null);
      // After the render that marks the fields, not before it.
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      await call('updateEventConfig', { event: toPayload(form, { includeSender: canEditSender }) });
      setForm((current) => ({
        ...current,
        venue: {
          ...current.venue,
          places: current.venue.places.map((place) => ({ ...place, persisted: true })),
        },
        // The saved letters are now the ones sessions can point at.
        tracks: markTracksSaved(current.tracks),
      }));
      setSocialChecked(false);
      setMilestonesChecked(false);
      setStatus('Saved. The site picks the change up live.');
      // The line above is the record and it announces; the bar repeats it.
      showToast('Event settings saved.', { announce: false });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const verified = senderDomainVerified(eventConfig?.sender);

  return (
    // noValidate: the form answers for its own fields (issue #219). Left to
    // the browser, a url or email field it calls invalid stops the submit
    // with a bubble, so this form's check never runs and nothing is marked.
    // The fields keep their types for the keyboard each one brings up.
    <form ref={formRef} className="flex flex-col gap-md" onSubmit={submit} noValidate>
      <AdminPageHeader
        title="Event"
        description="Name, dates, venue, milestones, social accounts, and the addresses the site and its email use."
        actions={
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={saving}
            aria-busy={saving || undefined}
          >
            {saving ? 'Saving…' : 'Save event settings'}
          </button>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <div className="admin-settings-groups">
        <div role="group" aria-labelledby="event-settings-essentials">
          <div className="admin-section-intro">
            <p id="event-settings-essentials" className="admin-settings-group-title">Event essentials</p>
            <p>The name, event days, and session tracks that shape the schedule.</p>
          </div>
          <div className="admin-settings-grid admin-settings-grid--essentials">
            <Panel className="admin-settings-card" title="Identity" description="The event name and time zone used on the site and in email.">
              <div className="admin-settings-fields">
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
                <div className="admin-settings-field--wide">
                  <TextField
                    label="Tagline"
                    value={form.tagline}
                    onChange={(value) => setForm((c) => ({ ...c, tagline: value }))}
                    error={errorFor('tagline')}
                  />
                </div>
                <div className="admin-settings-field--wide">
                  <TimeZoneField
                    value={form.timezone}
                    onChange={(value) => setForm((c) => ({ ...c, timezone: value }))}
                    error={errorFor('timezone')}
                    days={form.days}
                  />
                </div>
              </div>
            </Panel>
            <EventDaysEditor
              days={form.days}
              onChange={(days) => setForm((c) => ({ ...c, days }))}
              errorFor={errorFor}
              dayUsage={dayUsage}
            />
            <EventTracksEditor
              tracks={form.tracks}
              onChange={(tracks) => setForm((c) => ({ ...c, tracks }))}
              errorFor={errorFor}
              trackUsage={trackUsage}
            />
          </div>
        </div>
        <div role="group" aria-labelledby="event-settings-venue">
          <div className="admin-section-intro">
            <p id="event-settings-venue" className="admin-settings-group-title">Venue and wayfinding</p>
            <p>Address, rooms, walking routes, and the venue map.</p>
          </div>
          <div className="admin-settings-grid">
            <Panel className="admin-settings-card" title="Venue" description="The main event location and its street address.">
              <div className="admin-settings-fields">
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
            <VenueReferenceEditor
              venue={form.venue}
              onChange={(patch) => setGroup('venue', patch)}
              errorFor={errorFor}
              placeUsage={placeUsage}
            />
          </div>
        </div>
        <div role="group" aria-labelledby="event-settings-registration">
          <div className="admin-section-intro">
            <p id="event-settings-registration" className="admin-settings-group-title">Registration and deadlines</p>
            <p>Registration links, goals, and the dates your team is working toward.</p>
          </div>
          <div className="admin-settings-grid">
            <Panel className="admin-settings-card"
              title="Registration"
              description="Dates are naive local datetimes (YYYY-MM-DDTHH:MM) in the event’s timezone. The URL and label below are the register control the site shows."
            >
              <div className="admin-settings-fields">
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
                {/* The registration action (M7 issue 8). One destination, used
                    both by the control the site draws and by the registration
                    email the manual ticket provider sends, so the two can never
                    point at different places. Leaving the URL empty is a real
                    answer: no control is drawn anywhere. */}
                <div className="admin-settings-field--wide">
                  <TextField
                    label="External registration URL"
                    value={form.registration.externalUrl}
                    onChange={(value) => setGroup('registration', { externalUrl: value })}
                    error={errorFor('registration.externalUrl')}
                    hint="Must start with https://. Leave it empty and no register control is shown."
                  />
                </div>
                <div className="admin-settings-field--wide">
                  <TextField
                    label="Register button label"
                    value={form.registration.actionLabel}
                    onChange={(value) => setGroup('registration', { actionLabel: value })}
                    error={errorFor('registration.actionLabel')}
                    hint="What the register control says. Empty means it says Register."
                  />
                </div>
                {/* The goal (issue #180): the overview sets the approved count
                    against it. A text field with a numeric keyboard rather than
                    type="number", because a number field reads an entry it cannot
                    parse as empty, and an empty goal is sent as null, which would
                    clear the stored goal instead of refusing the entry. */}
                <TextField
                  label="Registration goal"
                  inputMode="numeric"
                  value={form.registration.goal}
                  onChange={(value) => setGroup('registration', { goal: value })}
                  error={errorFor('registration.goal')}
                  hint="The number of approved attendees you are aiming for. Anyone can read it. The overview compares the approved count with it. Leave it empty for no goal."
                  className="font-admin-data"
                />
              </div>
            </Panel>
            <MilestonesEditor
              milestones={form.milestones}
              onChange={(milestones) => setForm((current) => ({ ...current, milestones }))}
              errorFor={errorFor}
            />
          </div>
        </div>
        <div role="group" aria-labelledby="event-settings-communications">
          <div className="admin-section-intro">
            <p id="event-settings-communications" className="admin-settings-group-title">Email and organizer</p>
            <p>The sender details and contact addresses used across the event.</p>
          </div>
          <div className="admin-settings-grid">
            <Panel className="admin-settings-card"
              title="Sender"
              description={
                canEditSender
                  ? 'The From address every transactional email uses.'
                  : 'The From address every transactional email uses. You can read it here. An operator changes it.'
              }
            >
              <div className="admin-settings-fields">
                <TextField
                  label="Sender email"
                  type="email"
                  value={form.sender.email}
                  onChange={(value) => setGroup('sender', { email: value })}
                  error={errorFor('sender.email')}
                  readOnly={!canEditSender}
                />
                <TextField
                  label="Sender name"
                  value={form.sender.name}
                  onChange={(value) => setGroup('sender', { name: value })}
                  error={errorFor('sender.name')}
                  readOnly={!canEditSender}
                />
                <TextField
                  label="Reply-to"
                  type="email"
                  value={form.sender.replyTo}
                  onChange={(value) => setGroup('sender', { replyTo: value })}
                  error={errorFor('sender.replyTo')}
                  readOnly={!canEditSender}
                />
                <p className="self-center text-admin-sm text-admin-ink-secondary">
                  Sender domain:{' '}
                  <StatusBadge tone={verified ? 'ok' : 'caution'}>
                    {verified ? 'verified' : 'not verified'}
                  </StatusBadge>
                  . Verification is set by the sender-domain job, not from here.
                </p>
              </div>
            </Panel>
            <Panel className="admin-settings-card" title="Operator contacts" description="Who runs the event and where attendees can ask for help.">
              <div className="admin-settings-fields">
                <TextField
                  label="Operator name"
                  value={form.legal.operatorName}
                  onChange={(value) => setGroup('legal', { operatorName: value })}
                  error={errorFor('legal.operatorName')}
                />
                <TextField
                  label="Support email"
                  type="email"
                  value={form.legal.supportEmail}
                  onChange={(value) => setGroup('legal', { supportEmail: value })}
                  error={errorFor('legal.supportEmail')}
                />
                <TextField
                  label="Conduct email"
                  type="email"
                  value={form.legal.conductEmail}
                  onChange={(value) => setGroup('legal', { conductEmail: value })}
                  error={errorFor('legal.conductEmail')}
                />
              </div>
            </Panel>
          </div>
        </div>
        <div role="group" aria-labelledby="event-settings-resources">
          <div className="admin-section-intro">
            <p id="event-settings-resources" className="admin-settings-group-title">Public links and resources</p>
            <p>Search details, speaker materials, and the event’s social accounts.</p>
          </div>
          <div className="admin-settings-grid admin-settings-grid--essentials">
            <Panel className="admin-settings-card" title="Search presence" description="The event description and organizer links used by search engines.">
              <div className="admin-settings-fields">
                <div className="admin-settings-field--wide">
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
            <Panel className="admin-settings-card"
              title="Speaker resources"
              description="Set the external slide template link shown on the speaker dashboard. Leave both fields empty to omit it."
            >
              <div className="admin-settings-fields">
                <TextField
                  label="Slide template label"
                  value={form.speakerResources.slideTemplate.label}
                  onChange={(value) => setSlideTemplate({ label: value })}
                  error={errorFor('speakerResources.slideTemplate.label')}
                />
                <TextField
                  label="Slide template URL"
                  type="url"
                  value={form.speakerResources.slideTemplate.url}
                  onChange={(value) => setSlideTemplate({ url: value })}
                  error={errorFor('speakerResources.slideTemplate.url')}
                  hint="Use an absolute http:// or https:// link."
                />
              </div>
            </Panel>
            <SocialHandlesEditor
              social={form.social}
              onChange={(patch) => setGroup('social', patch)}
              errorFor={errorFor}
            />
          </div>
        </div>
      </div>
    </form>
  );
}
