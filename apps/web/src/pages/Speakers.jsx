// Speakers page — placeholder the speakers tranche replaces.
// TODO(m2-speakers): speaker detail routes, headshot rendering from Storage
// branding paths, session cross-links.
// Feature-gated by config/features.speakers — the nav link already hides
// when the feature is off, but the route itself must gate too, since direct
// navigation bypasses the nav (matches the Schedule.jsx pattern).
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Speakers() {
  const { features } = useEventConfig();
  const { speakers } = useContent();
  const visible = speakers.filter((s) => s.visible);

  if (!features.speakers) {
    return (
      <EmptyState
        title="This event doesn’t have a public speaker directory"
        description="Everything else about the event is on the home page."
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">Speakers</h1>
      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Speakers have not been announced yet"
            description="Speaker profiles appear here once they are published."
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((speaker) => (
            <li
              key={speaker.id}
              className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
            >
              <h2 className="font-heading text-lg text-brand-ink">{speaker.name}</h2>
              <p className="mt-1 text-sm text-brand-ink-muted">{speaker.title}</p>
              <p className="mt-2 text-brand-ink-muted">{speaker.bio}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
