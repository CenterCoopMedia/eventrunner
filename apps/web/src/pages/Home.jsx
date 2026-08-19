// Home page — placeholder the pages tranche replaces with the full
// section/block renderer driven by cmsPages (spec §5.2). For now it renders
// the hero from the snapshot so the shell proves the read path end to end.
// TODO(m2-pages): render sections/blocks from cmsPages + BLOCK_TYPES renderers.
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Home() {
  const { eventConfig } = useEventConfig();
  const { getBlock } = useContent();

  const title = getBlock('hero', 'title');
  const subtitle = getBlock('hero', 'subtitle');
  const registerCta = getBlock('hero', 'register_cta');

  if (!title) {
    return (
      <EmptyState
        title="This site has no content yet"
        description="Once an editor publishes the home page, it appears here."
      />
    );
  }

  return (
    <article>
      <section aria-labelledby="hero-title" className="py-8">
        <p className="font-accent text-2xl text-brand-accent">{eventConfig.tagline}</p>
        <h1 id="hero-title" className="mt-2 font-heading text-4xl font-semibold text-brand-ink">
          {title.value}
        </h1>
        {subtitle ? (
          <p className="mt-4 max-w-prose text-lg text-brand-ink-muted">{subtitle.value}</p>
        ) : null}
        {registerCta ? (
          <p className="mt-8">
            <a
              href={registerCta.url}
              {...(registerCta.external
                ? { target: '_blank', rel: 'noreferrer' }
                : {})}
              className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
            >
              {registerCta.label}
            </a>
          </p>
        ) : null}
      </section>
      <section aria-label="Event days" className="mt-8 grid gap-4 sm:grid-cols-2">
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
    </article>
  );
}
