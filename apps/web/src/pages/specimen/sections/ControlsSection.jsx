// Every control, in every state.
//
// A state is a word, an ink change, a weight change, or a rule change. It
// is never colour alone, and it is never a pill. The record §2.1 fixes ten
// states, and each control below accounts for all ten: it draws the ones it
// has, laid out as a grid so a reviewer reads down one state across every
// control as easily as across one control, and it names the ones it does
// not have with the reason, under the grid.
//
// The reasons are the point of the second list. A state that is simply
// missing looks the same as a state somebody decided against, and only one
// of those is a defect.
import { CONTROL_SPECIMENS } from '../controls/index.js';
import { CONTROL_STATES, stateLabel } from '../controls/states.js';
import ExternalLink from '../../../components/ExternalLink.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { useLiveToken } from '../useLiveToken.js';
import { FOCUS_TOKENS, STATE_SHARES, formatTokenValue } from '../tokens.js';

/** One token row: the name, what it is for, and the value in force now. */
function TokenRow({ entry }) {
  const value = useLiveToken(entry.token);
  return (
    <div className="grid gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline py-2xs sm:grid-cols-[8rem,1fr,6rem]">
      <dt className="font-data text-caption font-semibold text-text-primary">{entry.label}</dt>
      <dd className="font-data text-caption text-text-secondary text-pretty">{entry.job}</dd>
      <dd className="font-mono text-caption text-text-secondary sm:text-end">
        {formatTokenValue(value) || entry.token}
      </dd>
    </div>
  );
}

/** The control's own states, in the record's order. */
function drawnStates(control) {
  return CONTROL_STATES.filter((state) => control.states.includes(state.id));
}

function ControlFigure({ control }) {
  return (
    <Figure
      name={control.name}
      file={control.file}
      contract={control.contract}
      note={control.note}
    >
      <dl className="grid gap-x-lg gap-y-md sm:grid-cols-2 lg:grid-cols-3">
        {drawnStates(control).map((state) => (
          <div key={state.id} className="flex flex-col gap-2xs">
            <dt className="font-data text-caption text-text-secondary">{state.label}</dt>
            <dd>{control.render(state.id)}</dd>
          </div>
        ))}
      </dl>
      {control.absent.length === 0 ? null : (
        <dl className="mt-md max-w-prose">
          {control.absent.map((entry) => (
            <div key={entry.state} className="border-t-hairline border-t-rule-hairline py-2xs">
              <dt className="font-data text-caption font-semibold text-text-primary">
                {stateLabel(entry.state)}
              </dt>
              <dd className="font-data text-caption text-text-secondary text-pretty">
                {entry.reason}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Figure>
  );
}

export default function ControlsSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-controls"
      title="Controls"
      folio={folio}
      standfirst="Ten states, one grammar. Each control draws the states it has and says which ones it does not have, and why."
    >
      <Figure
        name="State tints and the focus ring"
        file="design/tokens/semantic.json"
        contract={null}
        note="A tint is a share, not a colour: the shared rule mixes a control’s own ink into the ground it already sits on, so one number covers the page ground, the alternate ground and a filled action. Dark mode carries the higher share, because the same amount of ink is a smaller step on a dark ground. The ring is its own family, because a ring answers “where am I” and a rule is structure a reader passes over."
      >
        <dl>
          {[...STATE_SHARES, ...FOCUS_TOKENS].map((entry) => (
            <TokenRow key={entry.token} entry={entry} />
          ))}
        </dl>
      </Figure>

      {CONTROL_SPECIMENS.map((control) => (
        <ControlFigure key={control.id} control={control} />
      ))}

      <Figure
        name="External link marker"
        file="components/ExternalLink.jsx"
        contract={null}
        note="A link that opens a new tab says so inside its own name, in the same words everywhere. The sentence is hidden, so the marker in this figure looks like any other link until it is announced or inspected."
      >
        <p className="max-w-prose text-body text-text-primary">
          Every outbound link on the site carries it: the{' '}
          <ExternalLink href="https://example.org/programme" className="underline">
            recording
          </ExternalLink>
          , a supporter’s own site, a calendar file, and a call to action an editor points off
          site. A link that stays in this tab must never use it — a lie in a string nobody can see
          is the hardest kind to find.
        </p>
      </Figure>
    </SpecimenSection>
  );
}
