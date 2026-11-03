// The stepper's step list and pager (ADR 0008 §1).
import { MemoryRouter, useInRouterContext } from 'react-router';
import { StepHeading, StepList, StepPager } from '../../../components/forms/Stepper.jsx';
import { primaryActionClass, secondaryActionClass } from '../../../components/controlClasses.js';
import { sharedGrammar } from './states.js';

const STEPS = Object.freeze([
  Object.freeze({ slug: 'session', title: 'Your session', state: 'done' }),
  Object.freeze({ slug: 'format', title: 'Format', state: 'todo' }),
  Object.freeze({ slug: 'presenters', title: 'Presenters', state: 'locked' }),
  Object.freeze({ slug: 'review', title: 'Review', state: 'locked' }),
]);
const hrefFor = (step) => `#${step.slug}`;

/** The links need a router. The book has one; the registry test does not. */
function WithRouter({ children }) {
  return useInRouterContext() ? children : <MemoryRouter>{children}</MemoryRouter>;
}

function StepperSpecimen({ state }) {
  const wide = state !== 'empty';
  return (
    <WithRouter>
      <div className="flex flex-col gap-sm">
        <StepList steps={STEPS} current={1} hrefFor={hrefFor} wide={wide} label={`Example steps, ${state}`} />
        <StepHeading index={1} total={STEPS.length} title="Format" headingRef={null} headingId={`stepper-specimen-${state}`} />
        <StepPager previous={STEPS[0]} next={STEPS[2]} hrefFor={hrefFor} backClass={secondaryActionClass} nextClass={primaryActionClass} />
      </div>
    </WithRouter>
  );
}

export default Object.freeze({
  id: 'stepper',
  name: 'Stepper',
  file: 'components/forms/Stepper.jsx',
  contract: null,
  note: 'One step per page at its own address. Every step shows its number or a tick, its title, and its state as a word; the open step carries aria-current="step", the leading-edge rule and the bold weight. A step that cannot open yet is text, not a link. On a narrow screen the list folds into one line above the step. Next names the step it opens.',
  states: Object.freeze(['rest', 'selected', 'empty']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
    Object.freeze({
      state: 'disabled',
      reason: 'A step that cannot open yet is drawn as text with the words Not started, shown in every state above.',
    }),
    Object.freeze({ state: 'busy', reason: 'Moving between steps loads nothing; the step’s own submit carries the busy state.' }),
    Object.freeze({ state: 'error', reason: 'A step’s fields state their own errors; the list does not repeat them.' }),
    Object.freeze({ state: 'success', reason: 'A finished step shows a tick and the word Done in the list.' }),
  ]),
  render: (state) => <StepperSpecimen state={state} />,
});
