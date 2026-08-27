// Home page — the cmsPages 'home' document rendered section by section
// (spec §5.2). The lead section keeps a handcrafted treatment (headline,
// supporting line, primary action); every other section renders generically
// through SectionBlocks, so editors can add stats, body copy, or footer
// links without a code change. All copy comes from the snapshot/runtime
// content — nothing event-specific lives here.
//
// There is no hero banner (design brief §2.1, §5.1). The masthead nameplate
// in the shell opens the page, and the lead headline follows it at
// --text-h1, the way a lead story follows a paper's nameplate.
//
// The tagline sits BELOW the headline, never above it: the eyebrow ban is
// absolute (brief §2.4), and supporting copy above a headline is exactly the
// pattern it rejects.
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import CtaBlock from '../components/blocks/CtaBlock.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { formatDayDate } from '../lib/eventTime.js';

export default function Home() {
  const { eventConfig, features } = useEventConfig();
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
  // The shell's masthead nameplate carries the event name as this page's
  // <h1> (design brief §2.1). The stored hero title is the lead headline
  // that follows it — unless an editor typed the event name into it, in
  // which case the nameplate has already set those words at nameplate size
  // and repeating them under it is just the same headline twice.
  const leadTitle =
    typeof title?.value === 'string' && title.value !== eventConfig.name
      ? title.value
      : null;
  const heroCtas = getSectionBlocks('hero').filter(
    (block) => block.blockType === 'cta',
  );

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
    // own and never renders again as a slot section. Everything else the
    // page stores renders around the core in its stated slot.
    <SystemPage pageId={['home', '/']} exclude={['hero']} data-content-source={source}>
      <section
        className="pb-xl"
        {...(leadTitle ? { 'aria-labelledby': 'hero-title' } : { 'aria-label': 'Introduction' })}
      >
        {leadTitle ? (
          <h2 id="hero-title" className="font-heading text-h1 font-semibold text-text-primary">
            {leadTitle}
          </h2>
        ) : null}
        {typeof eventConfig.tagline === 'string' ? (
          <p
            className={[
              'max-w-prose text-lead text-text-secondary',
              leadTitle ? 'mt-sm' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ textWrap: 'pretty' }}
          >
            {eventConfig.tagline}
          </p>
        ) : null}
        {subtitle ? (
          <p className="mt-sm max-w-prose text-body text-text-secondary" style={{ textWrap: 'pretty' }}>
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
                <h3 className="font-heading text-h3 text-text-primary">{day.label}</h3>
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

    </SystemPage>
  );
}
