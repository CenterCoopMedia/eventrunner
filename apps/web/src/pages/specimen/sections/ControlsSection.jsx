// Section 9: every control, in every state.
//
// A state is a word, an ink change, a weight change, or a rule change. It
// is never colour alone, and it is never a pill. Six states per control,
// laid out as a grid so a reviewer reads down one state across every
// control as easily as across one control.
import { CONTROL_SPECIMENS, PENDING_CONTROLS } from '../controls/index.js';
import { CONTROL_STATES } from '../controls/states.js';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';

function ControlFigure({ control }) {
  return (
    <Figure
      name={control.name}
      file={control.file}
      contract={control.contract}
      note={control.note}
    >
      <dl className="grid gap-x-lg gap-y-sm sm:grid-cols-2 lg:grid-cols-3">
        {CONTROL_STATES.map((state) => (
          <div key={state.id} className="flex flex-col gap-2xs">
            <dt className="font-data text-caption text-text-secondary">{state.label}</dt>
            <dd>{control.render(state.id)}</dd>
          </div>
        ))}
      </dl>
    </Figure>
  );
}

export default function ControlsSection() {
  return (
    <SpecimenSection
      id="specimen-controls"
      title="Controls"
      folio="Section 9"
      standfirst="Six states for every control: at rest, under the pointer, under the keyboard, held down, refused, and working."
    >
      {CONTROL_SPECIMENS.map((control) => (
        <ControlFigure key={control.id} control={control} />
      ))}

      <Figure
        name="Controls with a slot and no file"
        file="pages/specimen/controls/index.js"
        contract={null}
        note="Each control below joins this section as one file in pages/specimen/controls/. The registry needs one import and one line for each."
      >
        <ul className="font-data text-caption text-text-secondary">
          {PENDING_CONTROLS.map((control) => (
            <li
              key={control.export}
              className="flex flex-wrap gap-x-sm break-words border-t-hairline border-t-rule-hairline py-2xs"
            >
              <span className="font-mono text-text-primary">{control.export}</span>
              <span className="min-w-0 font-mono">{control.file}</span>
            </li>
          ))}
        </ul>
      </Figure>
    </SpecimenSection>
  );
}
