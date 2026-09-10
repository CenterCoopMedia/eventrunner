// The session row, the grid, the calling points, the transfer.
//
// The day reads twice and both readings are first-class, so both are here:
// the time-ordered row, and the two-axis grid. The grid excerpt keeps its
// signature interaction live — press or focus a track head and that column
// comes forward — because a still picture of that device says nothing.
import { useMemo } from 'react';
import { sessionMovement } from 'shared/venue';
import CallingPoints from '../../../components/CallingPoints.jsx';
import ScheduleGrid from '../../../components/ScheduleGrid.jsx';
import SessionCard from '../../../components/SessionCard.jsx';
import TransferLine from '../../../components/TransferLine.jsx';
import { resolveTracks, withCallingPoints } from '../../../lib/scheduleGrid.js';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { specimenEventConfig, specimenSchedule } from '../exampleContent.js';
import { eventConfig } from '@generated/eventConfig.js';
import { scheduleData } from '@generated/scheduleData.js';

// EVERY PIECE THIS SECTION DRAWS IS OPTIONAL IN config/event. The days may
// be empty, the lines and the rooms may be absent, and a snapshot may hold
// no session on the day the book picks. Each reader takes the event's own
// where the event states it and the book's authored example where it does
// not, so the section draws a schedule for every valid configuration.
const CONFIG = specimenEventConfig(eventConfig);
const { day: DAY, sessions: DAY_SESSIONS } = specimenSchedule(eventConfig, scheduleData);
const bySession = (id) =>
  scheduleData.find((session) => session.id === id)
  ?? DAY_SESSIONS.find((session) => session.id === id);
// The two rows the first figure draws: the seeded pair where the snapshot
// has them, and otherwise the first two sessions of the day above.
const SEEDED_ROWS = [bySession('session-panel'), bySession('session-workshop-money')];
const ROWS = SEEDED_ROWS.every(Boolean) ? SEEDED_ROWS : DAY_SESSIONS.slice(0, 2);

export default function ScheduleSection({ folio }) {
  const entries = useMemo(() => withCallingPoints(DAY_SESSIONS), []);
  const columns = useMemo(() => resolveTracks(CONFIG), []);
  const parentEntry = entries.find((entry) => entry.children.length > 0) ?? entries[0];
  const movement = sessionMovement(
    CONFIG,
    bySession('session-workshop-money') ?? DAY_SESSIONS[0],
    bySession('session-workshop-b') ?? DAY_SESSIONS.at(-1),
  );

  return (
    <SpecimenSection
      id="specimen-schedule"
      title="Sessions and schedule"
      folio={folio}
      standfirst="A day reads twice: a time-ordered list everywhere, and a two-axis grid where the event lists tracks."
    >
      <Figure
        name="Session row"
        file="components/SessionCard.jsx"
        contract="session-card"
        note="A ruled entry in a printed programme. The time is a column in the mono face, the format is a word beside the title, and the site style decides the whole treatment."
      >
        <ul>
          {ROWS.map((session, index) => (
            <SessionCard
              key={session.id}
              session={session}
              eventConfig={CONFIG}
              linkToDetail={false}
              lead={index === 0}
              position={index === 0 ? undefined : index + 1}
            />
          ))}
        </ul>
      </Figure>

      <Figure
        name="Schedule grid"
        file="components/ScheduleGrid.jsx"
        contract="schedule"
        note="Two tracks and the whole of day two: a session on no line runs the width of the grid, and two workshops share one time. Press or focus a track head to bring that column forward. Under a reduced-motion setting the column still comes forward and nothing moves."
      >
        <div className="overflow-x-auto">
          <ScheduleGrid
            day={DAY}
            entries={entries}
            columns={columns}
            eventConfig={CONFIG}
          />
        </div>
      </Figure>

      <Figure
        name="Calling points"
        file="components/CallingPoints.jsx"
        contract={null}
        note="A parent session's children sit inside its time, never as rows of their own. The list opens by default."
      >
        <CallingPoints
          parent={parentEntry.session}
          points={parentEntry.children}
          eventConfig={CONFIG}
        />
      </Figure>

      <Figure
        name="Transfer line"
        file="components/TransferLine.jsx"
        contract={null}
        note="One recorded, one-way move between two rooms. The step-free way is in the operator's own words, and silence means nobody surveyed one."
      >
        <TransferLine movement={movement} />
      </Figure>
    </SpecimenSection>
  );
}
