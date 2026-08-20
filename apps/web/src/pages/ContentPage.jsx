// Generic content page for the /p/:slug route (spec §5.2): renders any
// visible non-system cmsPages document from its sections, so a client adding
// a page is a CMS action, not a PR. System pages have dedicated routes and
// 404 here rather than rendering twice.
import { Link, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';

export default function ContentPage() {
  const { slug } = useParams();
  const { getPage, getSectionBlocks } = useContent();

  const page = getPage(slug) ?? getPage(`/p/${slug}`);

  if (!page || page.systemPage) {
    return (
      <EmptyState
        title="This page is not available"
        description={`No published page exists at /p/${slug}. If you followed a link here, the page may not be published yet.`}
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  const sections = (page.sections ?? [])
    .map((section) => ({ section, blocks: getSectionBlocks(section.id) }))
    .filter(({ blocks }) => blocks.length > 0);

  return (
    <article>
      <h1 className="py-8 font-heading text-4xl font-semibold text-brand-ink">
        {page.label}
      </h1>
      {sections.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="This page is published but has no visible content. Check back soon."
          action={
            <Link
              to="/"
              className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
            >
              Go to the home page
            </Link>
          }
        />
      ) : (
        sections.map(({ section, blocks }, index) => (
          <section
            key={section.id}
            aria-labelledby={`section-${section.id}`}
            className={index === 0 ? undefined : 'mt-12'}
          >
            {/* The first section's label usually repeats the page title;
                keep it for screen readers only. */}
            <h2
              id={`section-${section.id}`}
              className={
                index === 0
                  ? 'sr-only'
                  : 'font-heading text-2xl font-semibold text-brand-ink'
              }
            >
              {section.label}
            </h2>
            <div className={index === 0 ? undefined : 'mt-4'}>
              <SectionBlocks blocks={blocks} />
            </div>
          </section>
        ))
      )}
    </article>
  );
}
