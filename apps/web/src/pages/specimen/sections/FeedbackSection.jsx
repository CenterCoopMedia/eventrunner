// Section 11: what the site says back.
//
// Every device here states a result in words. None of them is a spinner,
// a shimmer, a pulsing dot, or a colour on its own. A toast repeats a
// result the page already states, so a reader who missed it still has it.
import EmptyState from '../../../components/EmptyState.jsx';
import EventCountdown from '../../../components/EventCountdown.jsx';
import InfoCards, { groupIntoCards } from '../../../components/InfoCards.jsx';
import LoadingState from '../../../components/LoadingState.jsx';
import RegistrationAction, {
  resolveRegistrationLink,
} from '../../../components/RegistrationAction.jsx';
import { quietActionClass } from '../../../components/controlClasses.js';
import { useToast } from '../../../contexts/ToastContext.jsx';
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

function ToastSpecimen() {
  const toast = useToast();
  return (
    <div>
      {/* The still copy, so a printed capture holds one. */}
      <p className="flex items-center gap-sm rounded-brand border-strong border-rule-strong bg-text-primary px-md py-sm text-surface">
        Your session is saved to your schedule.
      </p>
      <p className="mt-sm">
        <button
          type="button"
          className={quietActionClass}
          onClick={() => toast?.showToast?.('Your session is saved to your schedule.')}
        >
          Raise a real toast
        </button>
      </p>
    </div>
  );
}

export default function FeedbackSection() {
  return (
    <SpecimenSection
      id="specimen-feedback"
      title="Feedback"
      folio="Section 11"
      standfirst="Every result is a word in place. Nothing spins, nothing pulses, and nothing says a thing with colour alone."
    >
      <Figure
        name="Toast"
        file="contexts/ToastContext.jsx"
        contract={null}
        note="A rule and a word on the ink ground. It repeats a result the page already states, and it announces through role=status."
      >
        <ToastSpecimen />
      </Figure>

      <Figure
        name="Status line"
        file="components/SignInPanel.jsx"
        contract={null}
        note="The in-place result pattern the public pages use. A site-wide notice bar with its own level and a dismiss control is not built yet."
      >
        <p role="status" className="font-data text-caption text-text-secondary">
          We sent a sign-in code to your email address.
        </p>
      </Figure>

      <Figure
        name="Loading"
        file="components/LoadingState.jsx"
        contract={null}
        note="A stated line that says what is loading. No spinner, and the space it holds does not move."
      >
        <LoadingState label="Loading the schedule…" />
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
