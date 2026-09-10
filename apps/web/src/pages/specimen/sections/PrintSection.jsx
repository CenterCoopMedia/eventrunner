// What this page does on paper.
//
// Paper has no dark mode. The print rules read the ink and rule tokens and
// nothing else, so pointing those at the light palette is the whole switch,
// and no print rule has to know a mode exists. Print this page from a dark
// screen and you get the light edition.
//
// The print view is its own view, not the screen with the controls hidden.
// SchedulePrint is display:none outside print media, so it never reaches
// the accessibility tree twice. That is why the figure below draws the
// device and states that the picture is empty on screen by design.
import SchedulePrint from '../../../components/SchedulePrint.jsx';
import { resolveTracks } from '../../../lib/scheduleGrid.js';
import { quietActionClass } from '../../../components/controlClasses.js';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { eventConfig } from '@generated/eventConfig.js';
import { scheduleData } from '@generated/scheduleData.js';

const sessionsByDay = new Map(
  eventConfig.days.map((day) => [
    day.id,
    scheduleData.filter((session) => session.dayId === day.id),
  ]),
);

const PRINT_RULES = Object.freeze([
  'Controls, navigation, and the footer leave the sheet. Nobody can press a button on paper.',
  'The screen schedule is hidden and the print view takes its place.',
  'A day opens on a strong rule, the way a standing head does on screen.',
  'A session row never breaks across two sheets.',
  'Calling points are indented under the session they belong to.',
  'Times keep tabular figures, so the time column lines up.',
]);

export default function PrintSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-print"
      title="Print"
      folio={folio}
      standfirst="This page prints as the light edition, whatever mode the screen is in."
    >
      <Figure
        name="Print rules"
        file="apps/web/src/index.css"
        contract={null}
        note="The live palette prints, not the palette the build shipped with: the runtime element writes its own print block from the resolved colours and wins on document order."
      >
        <ul className="max-w-prose">
          {PRINT_RULES.map((rule) => (
            <li
              key={rule}
              className="border-t-hairline border-t-rule-hairline py-2xs text-body text-text-primary"
            >
              {rule}
            </li>
          ))}
        </ul>
        <p className="no-print mt-md">
          <button type="button" className={quietActionClass} onClick={() => window.print()}>
            Print this page
          </button>
        </p>
      </Figure>

      <Figure
        name="Print view"
        file="components/SchedulePrint.jsx"
        contract={null}
        note="The programme a desk hands out: every day, every session and every stop under it, tracks named by letter and by name. The stage above is empty on screen on purpose, because the device is display:none outside print media."
      >
        <SchedulePrint
          days={eventConfig.days}
          sessionsByDay={sessionsByDay}
          columns={resolveTracks(eventConfig)}
          eventConfig={eventConfig}
        />
      </Figure>
    </SpecimenSection>
  );
}
