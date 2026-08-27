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
import { resolveHeader } from 'shared/theme';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';
import CtaBlock from '../components/blocks/CtaBlock.jsx';
import LeadImage from '../components/LeadImage.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { formatDayDate } from '../lib/eventTime.js';

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
  const heroBlocks = getSectionBlocks('hero');
  const heroCtas = heroBlocks.filter((block) => block.blockType === 'cta');
  // One lead image at most. An editor who stores several images in the
  // opening section gets the first one, never a gallery.
  const lead = heroBlocks.find((block) => block.blockType === 'image') ?? null;
  const otherSections = (page?.sections ?? []).filter(
    (section) => section.id !== 'hero',
  );
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
    <article data-content-source={source}>
      <section
        className="pb-xl"
        {...(leadTitle ? { 'aria-labelledby': 'hero-title' } : { 'aria-label': 'Introduction' })}
      >
        <div className="flex flex-col gap-lg lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
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
                  'max-w-prose text-lead text-text-secondary',
                  leadTitle && !titleRepeatsMasthead ? 'mt-sm' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ textWrap: 'pretty' }}
              >
                {tagline}
              </p>
            ) : null}
            {subtitle ? (
              <p
                className="mt-sm max-w-prose text-body text-text-secondary"
                style={{ textWrap: 'pretty' }}
              >
                {subtitle.value}
              </p>
            ) : null}
            {heroCtas.length ? (
              <div className="mt-lg flex flex-wrap gap-sm">
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
        <div className="mb-xl">
          <LiveUpdatesCard />
        </div>
      ) : null}

      {/* The dates as a ruled list, not a set of cards: label in the heading
          face, the day's date and hours in the mono face so the figures line
          up as a column (brief §2.1, §3.2). */}
      {Array.isArray(eventConfig.days) && eventConfig.days.length ? (
        <section aria-labelledby="event-days">
          <SectionHead level={2} id="event-days" title="Dates" />
          <ul className="mt-sm">
            {eventConfig.days.map((day) => (
              <li
                key={day.id}
                className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline py-sm"
              >
                <h3 className="font-heading text-h3 font-semibold text-text-primary">
                  {day.label}
                </h3>
                <p className="font-mono text-caption text-text-secondary">
                  <time dateTime={day.date}>
                    {formatDayDate(day, eventConfig.timezone) ?? day.date}
                  </time>
                  {day.startTime && day.endTime ? ` · ${day.startTime}–${day.endTime}` : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {otherSections.map((section) => {
        const blocks = getSectionBlocks(section.id);
        if (!blocks.length) return null;
        return (
          <section
            key={section.id}
            aria-labelledby={`section-${section.id}`}
            className="mt-2xl"
          >
            <SectionHead level={2} id={`section-${section.id}`} title={section.label} />
            <div className="mt-md">
              <SectionBlocks blocks={blocks} />
            </div>
          </section>
        );
      })}
    </article>
  );
}
