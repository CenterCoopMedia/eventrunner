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
import { eventConfig } from '@generated/eventConfig.js';
import { scheduleData } from '@generated/scheduleData.js';

const DAY = eventConfig.days[1];
const bySession = (id) => scheduleData.find((session) => session.id === id);

export default function ScheduleSection({ folio }) {
  const entries = useMemo(
    () => withCallingPoints(scheduleData.filter((session) => session.dayId === DAY.id)),
    [],
  );
  const columns = useMemo(() => resolveTracks(eventConfig), []);
  const parentEntry = entries.find((entry) => entry.children.length > 0) ?? entries[0];
  const movement = sessionMovement(
    eventConfig,
    bySession('session-workshop-money'),
    bySession('session-workshop-b'),
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
          <SessionCard
            session={bySession('session-panel')}
            eventConfig={eventConfig}
            linkToDetail={false}
            lead
          />
          <SessionCard
            session={bySession('session-workshop-money')}
            eventConfig={eventConfig}
            linkToDetail={false}
            position={2}
          />
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
            eventConfig={eventConfig}
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
          eventConfig={eventConfig}
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
