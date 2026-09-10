// Home page — the cmsPages 'home' document rendered section by section
// (spec §5.2). The lead section keeps a handcrafted treatment (headline,
// supporting line, primary action); every other section renders generically
// through SectionBlocks, so editors can add stats, body copy, or footer
// links without a code change. All copy comes from the snapshot/runtime
// content — nothing event-specific lives here.
//
// The page owns its own <h1>: the shell's header carries the running site
// identity, not this page's subject. Nothing sits above that heading.
//
// The opening section may carry one lead image, beside the copy or below it.
//
// THE PAGE IS BUILT ON THE STAGE (2026-09-10 vocabulary expansion). The
// masthead runs the full stage; the lead sentence sits at the measure with
// the lead image in the margin beside it; and then ONE composed moment —
// the summary row: the dates, the key facts, and the clock, three equal
// cells across the stage, separated by hairlines, each with its own head.
// Below `lg` the row stacks. It is not a bento grid and it is not a set of
// cards: no cell has a ground, a border or a shadow, and every cell holds
// real content. Everything after it is the ordinary section flow.
import { resolveHeader } from 'shared/theme';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import CtaBlock from '../components/blocks/CtaBlock.jsx';
import EventCountdown, { countdownDraws } from '../components/EventCountdown.jsx';
import InfoCards, { groupIntoCards } from '../components/InfoCards.jsx';
import LeadImage from '../components/LeadImage.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';
import RegistrationAction, {
  resolveRegistrationLink,
} from '../components/RegistrationAction.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { SponsorStrip } from '../components/SponsorWall.jsx';
import { formatDayDate } from '../lib/eventTime.js';

/**
 * The one composed moment on the first screen: three equal cells across the
 * stage — the dates, the key facts, and the clock — separated by a hairline
 * in the gutter, each opening on its own section boundary. Below `lg` the
 * row stacks and each cell's own rule is what separates it.
 *
 * Exported so the specimen book draws this row rather than a copy of it.
 * The book is where a reviewer sees the composition in six styles, and a
 * copy would be the one version of it nobody keeps in step.
 *
 * A cell that has nothing to say is not drawn, so the row is a row of two
 * or of one where the event has not recorded its days or the operator has
 * not written the facts. A row with no cell at all draws nothing.
 *
 * @param {{
 *   days: object[],
 *   timezone?: string,
 *   eventConfig: object,
 *   facts: { id: string, title: string, cards: object[] } | null,
 *   className?: string,
 * }} props
 */
export function SummaryRow({ days, timezone, eventConfig, facts, className = '' }) {
  const clock = countdownDraws(eventConfig);
  if (days.length === 0 && !facts && !clock) return null;
  return (
    <div className={['stage-row', className].filter(Boolean).join(' ')}>
      {/* The dates as a ruled list, not a set of cards: the label in the
          heading face, the day's date and hours in the mono face so the
          figures line up as a column (brief §2.1, §3.2). */}
      {days.length === 0 ? null : (
        <section aria-labelledby="event-days">
          <SectionHead level={2} id="event-days" title="Dates" />
          <ul className="mt-sm">
            {days.map((day) => (
              <li
                key={day.id}
                className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline py-sm"
              >
                <h3 className="font-heading text-h3 font-semibold text-text-primary">
                  {day.label}
                </h3>
                <p className="font-mono text-caption text-text-secondary">
                  <time dateTime={day.date}>{formatDayDate(day, timezone) ?? day.date}</time>
                  {day.startTime && day.endTime ? ` · ${day.startTime}–${day.endTime}` : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {facts ? (
        <section aria-labelledby={facts.id}>
          <SectionHead level={2} id={facts.id} title={facts.title} />
          <div className="mt-sm">
            {/* One cell wide, so the cards run down it rather than across
                a track that cannot hold three of them. */}
            <InfoCards cards={facts.cards} columns="single" />
          </div>
        </section>
      ) : null}
      <EventCountdown eventConfig={eventConfig} />
    </div>
  );
}

export default function Home() {
  const { eventConfig, features, theme } = useEventConfig();
  const { getPage, getSectionBlocks, getBlock, source } = useContent();

  const page = getPage('home') ?? getPage('/');
  const title = getBlock('hero', 'title');

  if (!page && !title) {
    return (
      <EmptyState
        title="This site has no content yet"
        description="Once an editor publishes the home page, it appears here."
      />
    );
  }

  const subtitle = getBlock('hero', 'subtitle');
  // The stored hero title is this page's heading. Where an editor has not
  // written one, the event's own name stands in — the page states what the
  // data says and never invents a headline of its own.
  const leadTitle =
    typeof title?.value === 'string' && title.value.trim()
      ? title.value
      : eventConfig.name;
  // config/event is runtime data, so the tagline may arrive as an empty
  // string. Test for content, not for the type: an empty string would
  // otherwise render an empty paragraph and its margin as a stray gap.
  const tagline =
    typeof eventConfig.tagline === 'string' && eventConfig.tagline.trim()
      ? eventConfig.tagline
      : null;
  // The event's own registration action (M7 issue 8), or null where no
  // destination is configured. Resolved here as well as inside the control
  // because the action row around it is drawn only when it holds something.
  const registrationAction = resolveRegistrationLink(eventConfig);
  const heroBlocks = getSectionBlocks('hero');
  const heroCtas = heroBlocks.filter((block) => block.blockType === 'cta');
  // config/event is runtime data, so `days` may arrive as anything.
  const days = Array.isArray(eventConfig.days) ? eventConfig.days : [];
  // Where the summary row is drawn. The row belongs to the key facts
  // section, so it renders in that section's own place (renderHomeSection
  // below). A page whose operator never had that section — or has deleted
  // it — still has dates and a clock to state, so the core draws the row
  // itself in that one case, with two cells instead of three.
  const hasFactsSection = (page?.sections ?? []).some((section) => section?.id === 'info');
  // TWO SECTIONS THIS PAGE DRAWS ITSELF, AND BOTH STAY IN THE OPERATOR'S
  // ORDER. Neither is a list of blocks the generic renderer can draw — the
  // key facts group is an arrangement of its section's blocks (M7 issue 9)
  // and the sponsor strip reads cmsOrganizations entirely (M7 issue 10) —
  // but "the page draws it" used to mean "excluded from the section list
  // and rendered at a fixed point in the core", which silently took both
  // out of the ordering. An operator could drag either one anywhere in the
  // admin, or move it to another slot, and nothing on the page moved.
  //
  // `renderSection` replaces only what is drawn INSIDE a section's own
  // place. Every other section gets `undefined` and renders exactly as it
  // did before, and either of these deleted from the page document is
  // simply gone, like any other deleted section.
  const renderHomeSection = (section, blocks) => {
    if (section.id === 'info') {
      // Grouped before the section is opened, because a section whose
      // blocks are all of some type this arrangement does not draw would
      // otherwise print its heading over nothing.
      const cards = groupIntoCards(blocks);
      // THE KEY FACTS ARE ONE CELL OF THE SUMMARY ROW, and the row is drawn
      // HERE, in this section's own place in the operator's order. Moving
      // the section in the admin moves the whole row, which is the control
      // the operator already has; excluding the section and drawing the row
      // at a fixed point in the core would make that control look like it
      // works and do nothing.
      return (
        <SummaryRow
          className="page-section"
          days={days}
          timezone={eventConfig.timezone}
          eventConfig={eventConfig}
          facts={cards.length ? { id: `section-${section.id}`, title: section.label, cards } : null}
        />
      );
    }
    if (section.id === 'sponsors') {
      // The feature is off: no strip, and no empty heading standing in for
      // one either.
      if (!features?.sponsors) return null;
      // The section's one text block is an optional line above the wall.
      // Tested for content, not for the type: an editor who cleared it
      // leaves an empty string behind, and an empty paragraph renders as
      // its own margin — a stray gap between the heading and the wall.
      const lede = blocks.find(
        (block) =>
          block.blockType === 'text' && typeof block.value === 'string' && block.value.trim(),
      );
      return (
        <SponsorStrip
          id={`section-${section.id}`}
          title={section.label}
          lede={lede?.value ?? null}
        />
      );
    }
    return undefined;
  };
  // One lead image at most. An editor who stores several images in the
  // opening section gets the first one, never a gallery.
  const lead = heroBlocks.find((block) => block.blockType === 'image') ?? null;
  // The masthead sets the event name at display size, so a headline that
  // only repeats it would print the same words twice down the page. The
  // page keeps its <h1> either way — a reader on a screen reader still
  // hears exactly one — and only the second printing goes.
  const titleRepeatsMasthead =
    resolveHeader(theme?.header) === 'masthead' && leadTitle === eventConfig.name;

  return (
    // data-content-source mirrors ContentContext's own `source` field
    // ('snapshot' | 'live') — inert everywhere except the e2e suite
    // (e2e/cms-publish.spec.js), which has no other DOM-observable way to
    // tell "the build-time snapshot is still rendering" apart from "the
    // runtime cmsContent listener has delivered its first live batch",
    // since a freshly-seeded project's live content and the committed demo
    // snapshot render identical text by construction (spec §8.6 hygiene).
    //
    // The lead is the core (brief §6.2), so the `hero` section is the core's
    // own and never renders again as a slot section. It is the only one:
    // every other section this page draws itself is drawn through
    // `renderSection`, in its own place in the operator's order.
    <SystemPage
      pageId={['home', '/']}
      exclude={['hero']}
      renderSection={renderHomeSection}
      data-content-source={source}
    >
      <section
        {...(leadTitle ? { 'aria-labelledby': 'hero-title' } : { 'aria-label': 'Introduction' })}
      >
        {/* The measure and the margin beside it: the opening copy runs to
            the measure and the lead image sits in the margin column at
            `lg` and above. Below `lg` the margin closes and the copy fills
            the stage. */}
        <div className="stage-split">
          <div className="min-w-0">
            {leadTitle ? (
              <h1
                id="hero-title"
                className={
                  titleRepeatsMasthead
                    ? 'sr-only'
                    : 'font-heading text-h1 font-semibold text-text-primary'
                }
              >
                {leadTitle}
              </h1>
            ) : null}
            {tagline ? (
              <p
                className={[
                  'max-w-prose text-lead text-text-secondary text-pretty',
                  leadTitle && !titleRepeatsMasthead ? 'mt-sm' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {tagline}
              </p>
            ) : null}
            {subtitle ? (
              <p className="mt-sm max-w-prose text-body text-text-secondary text-pretty">
                {subtitle.value}
              </p>
            ) : null}
            {/* The registration action leads the row: it is the event's own
                configured action, and the hero's cta blocks are whatever
                else an editor wanted beside it. The row itself is drawn
                only when something is in it — an empty flex row is a stray
                gap down the page, and an unset registration destination is
                the ordinary state of a fresh deployment. */}
            {registrationAction || heroCtas.length ? (
              <div className="mt-lg flex flex-wrap gap-sm">
                <RegistrationAction placement="lead" />
                {heroCtas.map((block) => (
                  <CtaBlock key={`${block.section}__${block.field}`} block={block} />
                ))}
              </div>
            ) : null}
          </div>
          {lead ? <LeadImage block={lead} /> : null}
        </div>
      </section>

      {features?.liveUpdates ? (
        <div className="my-xl">
          <LiveUpdatesCard />
        </div>
      ) : null}

      {hasFactsSection ? null : (
        <SummaryRow
          className="page-section"
          days={days}
          timezone={eventConfig.timezone}
          eventConfig={eventConfig}
          facts={null}
        />
      )}
    </SystemPage>
  );
}
