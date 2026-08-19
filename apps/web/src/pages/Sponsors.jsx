// Sponsors page — placeholder the sponsors tranche replaces.
// TODO(m2-sponsors): tier grouping/order from cmsOrganizations, logo
// rendering from Storage paths with the neutral placeholder fallback.
import { useContent } from '../contexts/ContentContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Sponsors() {
  const { organizationsData } = useContent();
  const visible = organizationsData.filter((o) => o.visible);

  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">Sponsors</h1>
      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Sponsors have not been announced yet"
            description="Supporting organizations appear here once they are published."
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {visible.map((org) => (
            <li
              key={org.id}
              className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
            >
              <h2 className="font-heading text-lg text-brand-ink">
                <a
                  href={org.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-brand-primary-dark"
                >
                  {org.name}
                </a>
              </h2>
              <p className="mt-1 text-sm uppercase tracking-wide text-brand-ink-muted">
                {org.tier}
              </p>
              <p className="mt-2 text-brand-ink-muted">{org.description}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
