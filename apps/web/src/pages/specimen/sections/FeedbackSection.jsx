// What the site says back.
//
// Every device here states a result in words. None of them is a spinner,
// a shimmer, a pulsing dot, or a colour on its own. A toast repeats a
// result the page already states, so a reader who missed it still has it.
import { useState } from 'react';
import EmptyState from '../../../components/EmptyState.jsx';
import EventCountdown from '../../../components/EventCountdown.jsx';
import FeedbackModal, { DIALOG_FRAME_CLASS } from '../../../components/FeedbackModal.jsx';
import InfoCards, { groupIntoCards } from '../../../components/InfoCards.jsx';
import LoadingState from '../../../components/LoadingState.jsx';
import NoticeBar, { NOTICE_LEVELS } from '../../../components/NoticeBar.jsx';
import Progress from '../../../components/Progress.jsx';
import RegistrationAction, {
  resolveRegistrationLink,
} from '../../../components/RegistrationAction.jsx';
import {
  primaryActionClass,
  quietActionClass,
  secondaryActionClass,
} from '../../../components/controlClasses.js';
import { TOAST_BAR_CLASS, TOAST_TONES, useToast } from '../../../contexts/ToastContext.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { eventConfig } from '@generated/eventConfig.js';
import { siteContent } from '@generated/siteContent.js';

// The `info` section is the one seeded section that carries a fact and the
// lines written under it, which is the whole shape of an info card.
const CARD_BLOCKS = Object.values(siteContent)
  .filter((block) => block.section === 'info')
  .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

const CARDS = groupIntoCards(CARD_BLOCKS);

/**
 * Both tones, drawn from the provider's own tone table.
 *
 * A live toast leaves after five seconds, so a still is the only way a
 * capture holds one. The bar's class and its two tones come from
 * ToastContext, so a tone added there appears here without a second edit.
 */
const TONE_LINES = Object.freeze({
  info: 'Your session is saved to your schedule.',
  error: 'We could not save that session. Try again.',
});

/**
 * One notice bar that comes back after it is dismissed. The product
 * remembers a dismissal per browser; a book that did the same would lose
 * its figure the first time a reviewer pressed the control.
 */
function NoticeSpecimen({ level }) {
  const [generation, setGeneration] = useState(0);
  return (
    <NoticeBar
      key={generation}
      id={`specimen-${level}`}
      level={level}
      remember={false}
      onDismiss={() => setGeneration((current) => current + 1)}
    >
      {level === 'urgent'
        ? 'The main hall is closed this morning. Sessions run in Room A until noon.'
        : 'Doors open at nine. The cloakroom is beside the main entrance.'}
    </NoticeBar>
  );
}

function ToastSpecimen() {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-sm">
      {Object.entries(TOAST_TONES).map(([tone, shape]) => (
        <p key={tone} className={`${TOAST_BAR_CLASS} ${shape.frame}`}>
          <span className="font-data text-folio font-semibold uppercase">{shape.word}</span>
          <span className="flex-1">{TONE_LINES[tone]}</span>
        </p>
      ))}
      <p>
        <button
          type="button"
          className={quietActionClass}
          onClick={() => toast?.showToast?.(TONE_LINES.info)}
        >
          Raise a real toast
        </button>
      </p>
    </div>
  );
}

/**
 * The dialog's frame, and a control that opens the real one.
 *
 * The still is a frame, not a form: a native dialog opened with
 * showModal() goes into the top layer and covers the page, which is right
 * in the product and useless in a capture. So the book draws the frame and
 * the scrim it sits on, and the four behaviours that make it a dialog —
 * the trap, the inert page behind it, Escape, and the return of focus —
 * are reachable through the control under it.
 */
function DialogSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* The scrim is the page's own ink at low alpha, never a blur. */}
      <div className="flex justify-center bg-text-primary/45 p-lg">
        <div className={DIALOG_FRAME_CLASS}>
          <h3 className="font-heading text-h3 font-semibold text-text-primary">Share feedback</h3>
          <p className="mt-sm max-w-prose text-body text-text-secondary">
            The form itself is the shared field set, drawn in Inputs. What the frame carries is the
            strong rule, the page ground, and the reading width.
          </p>
          <div className="mt-md flex flex-wrap justify-end gap-xs">
            <span className={secondaryActionClass}>Cancel</span>
            <span className={primaryActionClass}>Send feedback</span>
          </div>
        </div>
      </div>
      <p className="mt-sm">
        <button type="button" className={quietActionClass} onClick={() => setOpen(true)}>
          Open the real dialog
        </button>
      </p>
      {open ? <FeedbackModal onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export default function FeedbackSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-feedback"
      title="Feedback"
      folio={folio}
      standfirst="Every result is a word in place. Nothing spins, nothing pulses, and nothing says a thing with colour alone."
    >
      <Figure
        name="Toast"
        file="contexts/ToastContext.jsx"
        contract={null}
        ground="alt"
        note="Two tones, and neither of them is a colour: each states its own word at the head of the line and draws its own rule weight around the bar. The rule is drawn in the page ground, because the bar floats over content with nothing behind it to tint against, so the weight is the width of the halo around it — which is why these two sit on the alternate ground here and not on the page’s own. A toast repeats a result the page already states, and a repeat is silent, so one result is announced once."
      >
        <ToastSpecimen />
      </Figure>

      <Figure
        name="Dialog"
        file="components/FeedbackModal.jsx"
        contract={null}
        note="A native dialog opened with showModal(): focus is trapped inside it, the page behind it is inert, Escape closes it, and focus returns to the control that opened it. The scrim is tinted ink at low alpha and carries no blur."
      >
        <DialogSpecimen />
      </Figure>

      <Figure
        name="Notice bar"
        file="components/NoticeBar.jsx"
        contract="notice-bar"
        note="A site-wide message with a level, as a ruled band under the header. The level is a word and a rule weight: Notice on the hairline as a status region, Urgent on the strong rule as an alert. The dismiss control is remembered per browser on the site; the book forgets it and redraws the bar after a press, so the figure is always here."
      >
        <div className="flex flex-col gap-md">
          {Object.keys(NOTICE_LEVELS).map((level) => (
            <NoticeSpecimen key={level} level={level} />
          ))}
        </div>
      </Figure>

      <Figure
        name="Progress"
        file="components/Progress.jsx"
        contract="progress"
        note="How much of a set of tasks is done: a native progress element with the fraction stated beside it. Never a ring, never a meter, and nothing moves."
      >
        <div className="flex max-w-prose flex-col gap-md">
          <Progress value={3} max={5} />
          <Progress value={2} max={2} unit="files" done="sent" />
        </div>
      </Figure>

      <Figure
        name="Status line"
        file="components/SignInPanel.jsx"
        contract={null}
        note="The in-place result pattern the public pages use, in a role=status region that stays."
      >
        <p role="status" className="font-data text-caption text-text-secondary">
          We sent a sign-in code to your email address.
        </p>
      </Figure>

      <Figure
        name="Loading"
        file="components/LoadingState.jsx"
        contract={null}
        note="A stated line that says what is loading, and a block of hairline rules that holds the space the rows will take. The rules are not a skeleton: nothing imitates a heading, nothing imitates a photograph, and nothing moves, so the page does not reflow under a reader when the content lands."
      >
        <LoadingState label="Loading the schedule…" rows={4} />
      </Figure>

      <Figure
        name="Empty state"
        file="components/EmptyState.jsx"
        contract="plate"
        note="One sentence that names what is missing, and exactly one action. The style's own empty-state drawing sits with it where the style has one."
      >
        <EmptyState
          title="No session matches that search"
          description="Clear the search to read the whole programme."
          action={
            <button type="button" className={quietActionClass}>
              Clear the search
            </button>
          }
        />
      </Figure>

      <Figure
        name="Registration action"
        file="components/RegistrationAction.jsx"
        contract={null}
        note="The lead placement is the filled action and the header placement is the quiet one. Every action has a stated workflow behind it, so an event with no registration link draws no control at all rather than a dead one."
      >
        <RegistrationAction placement="lead" />
        {resolveRegistrationLink(eventConfig) ? null : (
          <p className="font-data text-caption text-text-secondary">
            This event configures no registration link, so the control is not in the page.
          </p>
        )}
      </Figure>

      <Figure
        name="Event countdown"
        file="components/EventCountdown.jsx"
        contract={null}
        note="A stated figure on the event's own clock, in tabular figures. It never counts up and it never animates."
      >
        <EventCountdown eventConfig={eventConfig} />
      </Figure>

      <Figure
        name="Info cards"
        file="components/InfoCards.jsx"
        contract="page"
        note="A fact and the lines written under it. A card with nothing in it is not drawn at all."
      >
        <InfoCards cards={CARDS} />
      </Figure>
    </SpecimenSection>
  );
}
