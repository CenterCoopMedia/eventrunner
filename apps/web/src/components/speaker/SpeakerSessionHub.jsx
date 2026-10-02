// The signed-in speaker's session hub (M12 issue #212).
//
// The session list comes from the public schedule projection and is joined to
// the account only by its canonical speaker id. Co-speakers resolve through
// speakers_public, never through another speaker's canonical profile.
import { useEffect, useMemo, useState } from 'react';
import SectionHead from '../editorial/SectionHead.jsx';
import { SelectField } from '../forms/publicForm.jsx';
import { Tab, TabList, TabPanel, Tabs } from '../forms/Tabs.jsx';
import { useSessionSpeakerNames } from '../SessionCard.jsx';
import { formatSessionTimeRange } from '../../lib/eventTime.js';
import { selectOwnSpeakerSessions } from '../../lib/speakerSessions.js';
import SpeakerSessionMaterials from './SpeakerSessionMaterials.jsx';

const TAB_IDS = Object.freeze(['details', 'co-speakers', 'materials']);

function Detail({ term, children, className = '' }) {
  return (
    <div className={className}>
      <dt className="font-data text-caption text-text-secondary">{term}</dt>
      <dd className="mt-2xs text-body text-text-primary">{children}</dd>
    </div>
  );
}

function SessionDetails({ eventConfig, session }) {
  const range = formatSessionTimeRange(eventConfig, session);
  const day = Array.isArray(eventConfig?.days)
    ? eventConfig.days.find((candidate) => candidate?.id === session.dayId)
    : null;

  return (
    <dl className="grid gap-md sm:grid-cols-2">
      <Detail term="Time">
        {day?.label ? <span>{day.label}</span> : null}
        {day?.label ? ' · ' : null}
        {range ? (
          <span className="font-mono">
            <time dateTime={range.startIso}>{range.startLabel}</time>
            {range.endLabel ? (
              <>
                –<time dateTime={range.endIso}>{range.endLabel}</time>
              </>
            ) : null}
            {range.zone ? <span className="ms-2xs">{range.zone}</span> : null}
          </span>
        ) : (
          'To be announced'
        )}
      </Detail>
      <Detail term="Room">{session.location || 'To be announced'}</Detail>
      <Detail term="Format">{session.type || 'Not specified'}</Detail>
      <Detail term="Description" className="sm:col-span-2">
        <span className="whitespace-pre-line text-pretty">
          {session.description || 'No description is available.'}
        </span>
      </Detail>
    </dl>
  );
}

function CoSpeakers({ session, speakerId }) {
  const publicSpeakers = useSessionSpeakerNames(session?.speakerIds);
  const coSpeakers = publicSpeakers.filter((speaker) => speaker.id !== speakerId);

  if (coSpeakers.length === 0) {
    return <p className="text-body text-text-secondary">No co-speakers are listed for this session.</p>;
  }

  return (
    <ul className="divide-y divide-rule-hairline">
      {coSpeakers.map((speaker) => (
        <li key={speaker.id} className="py-xs first:pt-0 last:pb-0">
          <span className="text-body text-text-primary">{speaker.displayName}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SpeakerSessionHub({ eventConfig, scheduleData, speakerId }) {
  const sessions = useMemo(
    () => selectOwnSpeakerSessions(scheduleData, speakerId, eventConfig),
    [eventConfig, scheduleData, speakerId],
  );
  const [selectedId, setSelectedId] = useState(() => sessions[0]?.id ?? '');
  const [activeTab, setActiveTab] = useState('details');
  const selectedSession = sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null;

  // A live schedule can remove the selected row or the signed-in account can
  // change. Move the control to the first row from the new canonical list;
  // never keep displaying a session that no longer belongs to this speaker.
  useEffect(() => {
    const nextId = selectedSession?.id ?? '';
    if (selectedId !== nextId) setSelectedId(nextId);
  }, [selectedId, selectedSession]);

  return (
    <section aria-labelledby="speaker-sessions-heading" className="mt-xl">
      <SectionHead id="speaker-sessions-heading" title="Your sessions" />
      {selectedSession ? (
        <div className="mt-md">
          <SelectField
            label="Session"
            value={selectedSession.id}
            onChange={setSelectedId}
            options={sessions.map((session) => ({ value: session.id, label: session.title }))}
          />
          <div className="mt-md">
            <Tabs value={activeTab} onChange={setActiveTab} tabs={TAB_IDS}>
              <TabList label={`${selectedSession.title} information`}>
                <Tab id="details">Details</Tab>
                <Tab id="co-speakers">Co-speakers</Tab>
                <Tab id="materials">Materials</Tab>
              </TabList>
              <TabPanel id="details">
                <SessionDetails eventConfig={eventConfig} session={selectedSession} />
              </TabPanel>
              <TabPanel id="co-speakers">
                <CoSpeakers session={selectedSession} speakerId={speakerId} />
              </TabPanel>
              <TabPanel id="materials">
                <SpeakerSessionMaterials
                  key={`${speakerId}:${selectedSession.id}`}
                  sessionId={selectedSession.id}
                  speakerId={speakerId}
                />
              </TabPanel>
            </Tabs>
          </div>
        </div>
      ) : (
        <p className="mt-md text-body text-text-secondary">No sessions are assigned to you.</p>
      )}
    </section>
  );
}
