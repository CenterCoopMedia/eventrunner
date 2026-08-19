// Speakers page — placeholder the speakers tranche replaces.
// TODO(m2-speakers): speaker detail routes, headshot rendering from Storage
// branding paths, session cross-links.
import { useContent } from '../contexts/ContentContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Speakers() {
  const { speakers } = useContent();
  const visible = speakers.filter((s) => s.visible);

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
