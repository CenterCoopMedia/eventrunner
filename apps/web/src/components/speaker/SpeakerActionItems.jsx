import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Progress from '../Progress.jsx';
import { secondaryActionClass } from '../controlClasses.js';
import { speakerCompletion } from '../../lib/speakerCompletion.js';
import { listSpeakerSessionMaterials } from '../../lib/speakerMaterialsApi.js';
import { selectOwnSpeakerSessions } from '../../lib/speakerSessions.js';

export default function SpeakerActionItems({ speaker, scheduleData, eventConfig, user, refreshKey }) {
  const sessions = useMemo(
    () => selectOwnSpeakerSessions(scheduleData, speaker.speakerId, eventConfig),
    [scheduleData, speaker.speakerId, eventConfig],
  );
  const sessionIds = useMemo(() => [...new Set(sessions.map((session) => session.id))], [sessions]);
  const scope = JSON.stringify([user?.uid ?? '', speaker.speakerId, sessionIds, refreshKey]);
  const request = useRef({ user, sessionIds });
  request.current = { user, sessionIds };
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState({ scope: '', status: 'loading', materialsBySession: {}, error: null });

  useEffect(() => {
    let current = true;
    const { user: requestUser, sessionIds: requestSessionIds } = request.current;
    setLoad({ scope, status: 'loading', materialsBySession: {}, error: null });
    Promise.all(requestSessionIds.map(async (sessionId) => [
      sessionId,
      await listSpeakerSessionMaterials({ user: requestUser, sessionId }),
    ])).then(
      (entries) => {
        if (current) {
          setLoad({ scope, status: 'ready', materialsBySession: Object.fromEntries(entries), error: null });
        }
      },
      () => {
        if (current) {
          setLoad({ scope, status: 'error', materialsBySession: {}, error: 'Your materials could not be checked.' });
        }
      },
    );
    return () => { current = false; };
  }, [scope, attempt]);

  const ready = load.scope === scope && load.status === 'ready';
  const completion = ready
    ? speakerCompletion({ speaker, sessions, materialsBySession: load.materialsBySession })
    : null;
  const loading = load.scope !== scope || load.status === 'loading';

  return (
    <section
      aria-labelledby="speaker-action-items-heading"
      className="mt-xl rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-md"
    >
      <h2 id="speaker-action-items-heading" className="font-heading text-h3 font-semibold text-text-primary">
        Your next steps
      </h2>
      {completion ? (
        <Progress value={completion.completed} max={completion.total} unit="items" done="complete" className="mt-sm" />
      ) : null}
      {loading ? (
        <p role="status" className="mt-md text-body text-text-secondary">Checking your next steps…</p>
      ) : null}
      {load.scope === scope && load.status === 'error' ? (
        <div className="mt-md">
          <p role="alert" className="text-body text-danger">{load.error}</p>
          <button type="button" className={`${secondaryActionClass} mt-sm`} onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {completion?.outstanding.length === 0 ? (
        <p className="mt-md text-body text-text-secondary">Your speaker checklist is complete.</p>
      ) : completion ? (
        <ul className="mt-md divide-y divide-rule-hairline">
          {completion.outstanding.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-xs py-xs first:pt-0 last:pb-0">
              <span className="wrap-anywhere min-w-0 text-body text-text-primary">{item.label}</span>
              <Link to={item.to} aria-label={`Open ${item.label}`} className={secondaryActionClass}>Open</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
