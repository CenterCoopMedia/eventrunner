// The speaker dashboard's event status (M12 issue #211): the public event
// countdown beside the next session assigned to this signed-in speaker.
// Session identity comes only from the canonical speaker id on cmsSchedule.
import { getEventPhase } from 'shared/config';
import EventCountdown from '../EventCountdown.jsx';
import SectionHead from '../editorial/SectionHead.jsx';
import { useEventClock } from '../../hooks/useEventClock.js';
import { formatSessionTimeRange } from '../../lib/eventTime.js';
import {
  nextSpeakerSession,
  selectOwnSpeakerSessions,
} from '../../lib/speakerSessions.js';

const FINISHED_PHASES = new Set(['ended', 'archived']);

export default function SpeakerStatusHeader({ eventConfig, scheduleData, speakerId }) {
  const now = useEventClock();
  const phase = getEventPhase(eventConfig, now);
  const finished = FINISHED_PHASES.has(phase);
  const sessions = selectOwnSpeakerSessions(scheduleData, speakerId, eventConfig);
  const nextSession = finished ? null : nextSpeakerSession(sessions, eventConfig, now);
  const range = nextSession ? formatSessionTimeRange(eventConfig, nextSession) : null;
  const day = nextSession && Array.isArray(eventConfig?.days)
    ? eventConfig.days.find((candidate) => candidate?.id === nextSession.dayId)
    : null;

  return (
    <div className="mt-xl grid items-start gap-lg lg:grid-cols-2">
      {!finished ? (
        <section aria-labelledby="speaker-next-session-heading" className="min-w-0">
          <SectionHead
            id="speaker-next-session-heading"
            title={nextSession?.title || 'Next session'}
            folio={nextSession ? 'Next session' : null}
          />
          {nextSession ? (
            <>
              <p className="mt-sm font-data text-caption text-text-secondary">
                {day?.label ? <span>{day.label}</span> : null}
                {day?.label && range ? ' · ' : null}
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
                  'Time to be announced'
                )}
              </p>
              {nextSession.location ? (
                <p className="mt-2xs font-data text-caption text-text-secondary">
                  {nextSession.location}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-sm text-body text-text-secondary">No upcoming session is scheduled.</p>
          )}
        </section>
      ) : null}
      <EventCountdown eventConfig={eventConfig} />
    </div>
  );
}
