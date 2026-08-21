// Home page — the cmsPages 'home' document rendered section by section
// (spec §5.2). The hero section keeps a handcrafted treatment (headline,
// supporting line, primary action); every other section renders generically
// through SectionBlocks, so editors can add stats, body copy, or footer
// links without a code change. All copy comes from the snapshot/runtime
// content — nothing event-specific lives here.
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';
import CtaBlock from '../components/blocks/CtaBlock.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';

export default function Home() {
  const { eventConfig, features } = useEventConfig();
  const { getPage, getSectionBlocks, getBlock } = useContent();

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
  const heroCtas = getSectionBlocks('hero').filter(
    (block) => block.blockType === 'cta',
  );
  const otherSections = (page?.sections ?? []).filter(
    (section) => section.id !== 'hero',
  );

  return (
    <article>
      <section aria-labelledby="hero-title" className="py-8">
        {typeof eventConfig.tagline === 'string' ? (
          <p className="font-accent text-2xl text-brand-accent">{eventConfig.tagline}</p>
        ) : null}
        <h1 id="hero-title" className="mt-2 font-heading text-4xl font-semibold text-brand-ink">
          {title?.value ?? eventConfig.name}
        </h1>
        {subtitle ? (
          <p className="mt-4 max-w-prose text-lg text-brand-ink-muted">{subtitle.value}</p>
        ) : null}
        {heroCtas.length ? (
          <div className="mt-8 flex flex-wrap gap-3">
            {heroCtas.map((block) => (
              <CtaBlock key={`${block.section}__${block.field}`} block={block} />
            ))}
          </div>
        ) : null}
      </section>

      {features?.liveUpdates ? (
        <div className="mt-8">
          <LiveUpdatesCard />
        </div>
      ) : null}

      <section aria-label="Event days" className="mt-4 grid gap-4 sm:grid-cols-2">
        {eventConfig.days.map((day) => (
          <div
            key={day.id}
            className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
          >
            <h2 className="font-heading text-lg text-brand-ink">{day.label}</h2>
            <p className="mt-1 text-brand-ink-muted">
              <time dateTime={day.date}>{day.date}</time> · {day.startTime}–{day.endTime}
            </p>
          </div>
        ))}
      </section>

      {otherSections.map((section) => {
        const blocks = getSectionBlocks(section.id);
        if (!blocks.length) return null;
        return (
          <section
            key={section.id}
            aria-labelledby={`section-${section.id}`}
            className="mt-12"
          >
            <h2
              id={`section-${section.id}`}
              className="font-heading text-2xl font-semibold text-brand-ink"
            >
              {section.label}
            </h2>
            <div className="mt-4">
              <SectionBlocks blocks={blocks} />
            </div>
          </section>
        );
      })}
    </article>
  );
}
