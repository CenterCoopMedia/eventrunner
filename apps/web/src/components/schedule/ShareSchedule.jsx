// ShareSchedule — the owner's consent panel for their shared schedule
// (issue #172).
//
// THE CHOICE IS SEPARATE FROM THE PROFILE'S. The profile's visibility
// choice says who can read the profile; this panel says who can read the
// saved sessions, and the two are asked separately on purpose — a public
// profile must never silently start carrying a public schedule, so the
// schedule ships private and widens only when the owner says so.
//
// WIDENING ASKS TWICE. Narrowing (or staying put) applies straight away,
// because it only shrinks who can read. Widening shows what the wider
// world would see and waits for a second press, because that is the one
// direction that can surprise the owner later.
//
// THE COPY LINK IS HONEST. It is offered at every level — a private
// schedule's link simply shows the private answer — so the control never
// disappears and never lies about what a visitor would receive.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  SCHEDULE_VISIBILITIES,
  setScheduleVisibility,
  subscribeOwnScheduleShare,
} from '../../lib/scheduleShareSource.js';
import { copyTextToClipboard } from '../../lib/clipboard.js';
import { quietActionClass } from '../controlClasses.js';
import { Radio } from '../forms/Choice.jsx';

const RANK = Object.freeze({ private: 0, attendees_only: 1, public: 2 });

const LEVEL_COPY = Object.freeze({
  private: {
    label: 'Nobody',
    description: 'Only you can see your saved sessions. A shared link says the schedule is private.',
  },
  attendees_only: {
    label: 'Attendees',
    description: 'Signed-in attendees with access can see your saved sessions.',
  },
  public: {
    label: 'Anyone',
    description: 'Anyone with your link can see your saved sessions.',
  },
});

/**
 * @param {{ uid: string }} props
 */
export default function ShareSchedule({ uid }) {
  const { user } = useAuth();
  const [share, setShare] = useState(null); // null = never saved anything
  const [pending, setPending] = useState(null); // a wider choice awaiting its second press
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const confirmRef = useRef(null);

  useEffect(
    () =>
      subscribeOwnScheduleShare(uid, (next) => {
        setShare(next);
      }),
    [uid],
  );

  const current = RANK[share?.scheduleVisibility] !== undefined ? share.scheduleVisibility : 'private';

  async function choose(next) {
    if (next === current) {
      setPending(null);
      return;
    }
    // Widening waits for the second press; narrowing applies at once.
    if (RANK[next] > RANK[current]) {
      setPending(next);
      requestAnimationFrame(() => confirmRef.current?.focus());
      return;
    }
    await apply(next);
  }

  async function apply(next) {
    setPending(null);
    setSaving(true);
    setError('');
    try {
      const result = await setScheduleVisibility({ user, visibility: next });
      setShare((was) => ({
        sessionIds: was?.sessionIds ?? result?.sessionIds ?? [],
        scheduleVisibility: result?.scheduleVisibility ?? next,
      }));
    } catch (err) {
      setError(err.message || 'The schedule visibility could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/schedule/user/${uid}`;
    const ok = await copyTextToClipboard(link);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 4000);
  }

  return (
    <section aria-labelledby="share-schedule-heading" className="mt-xl">
      <h2 id="share-schedule-heading" className="font-heading text-h3 font-semibold text-text-primary">
        Share your schedule
      </h2>
      <p className="mt-2xs max-w-prose text-body text-text-secondary">
        Your saved sessions have their own visibility, separate from your profile.
      </p>

      <fieldset className="mt-sm">
        <legend className="font-data text-caption font-semibold text-text-primary">
          Who can see your saved sessions
        </legend>
        <div className="mt-xs space-y-xs">
          {SCHEDULE_VISIBILITIES.map((value) => (
            <Radio
              key={value}
              name="scheduleVisibility"
              value={value}
              label={LEVEL_COPY[value].label}
              description={LEVEL_COPY[value].description}
              checked={pending ? pending === value : current === value}
              onChange={() => choose(value)}
              disabled={saving}
            />
          ))}
        </div>
      </fieldset>

      {pending ? (
        <div role="group" aria-label="Confirm widening" className="mt-sm border-t-hairline border-t-rule-hairline pt-sm">
          <p className="max-w-prose text-body text-text-primary">
            {pending === 'public'
              ? 'Anyone with your link will be able to see your saved sessions.'
              : 'Signed-in attendees will be able to see your saved sessions.'}
          </p>
          <div className="mt-xs flex flex-wrap gap-xs">
            <button
              ref={confirmRef}
              type="button"
              disabled={saving}
              onClick={() => apply(pending)}
              className={quietActionClass}
            >
              {pending === 'public' ? 'Share with anyone' : 'Share with attendees'}
            </button>
            <button type="button" disabled={saving} onClick={() => setPending(null)} className={quietActionClass}>
              Keep it as it is
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-sm font-data text-caption text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-sm flex flex-wrap items-center gap-xs">
        <button type="button" onClick={copyLink} className={quietActionClass}>
          Copy your schedule link
        </button>
        <p role="status" className="font-data text-caption text-text-secondary">
          {copied ? 'Copied.' : ''}
        </p>
      </div>
    </section>
  );
}
