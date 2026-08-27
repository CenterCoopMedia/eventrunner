// Sponsors page — the public directory of supporting organizations.
// TODO(m2-sponsors): tier grouping/order from cmsOrganizations, logo
// rendering from Storage paths with the neutral placeholder fallback. This
// restyle (design brief §2.1, §5.1) only changes presentation: the ruled
// list below renders the same fields the placeholder card grid did.
// Feature-gated by config/features.sponsors — the nav link already hides
// when the feature is off, but the route itself must gate too, since direct
// navigation bypasses the nav (matches the Schedule.jsx pattern).
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import { isSafeHref } from '../lib/sanitizeHtml.js';

export default function Sponsors() {
  const { features } = useEventConfig();
  const { organizationsData } = useContent();
  const visible = organizationsData.filter((o) => o.visible);

  if (!features.sponsors) {
    return (
      <EmptyState
        title="This event doesn’t have public sponsors"
        description="Everything else about the event is on the home page."
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  return (
    <SystemPage pageId="sponsors">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Sponsors</h1>
      {visible.length === 0 ? (
        <div className="mt-lg">
          <EmptyState
            title="Sponsors have not been announced yet"
            description="Supporting organizations appear here once they are published."
          />
        </div>
      ) : (
        // A ruled directory, not a card grid (design brief §2.1, §5.1): a
        // hairline opens each row, the same device Speakers.jsx and
        // SessionCard use in place of a card border. The tier sits below the
        // organization's name in the data face — metadata beside a heading,
        // never furniture above one (brief §2.4).
        <ul className="mt-lg">
          {visible.map((org) => (
            <li
              key={org.id}
              className="border-t-hairline border-t-rule-hairline py-md sm:grid sm:grid-cols-[1fr,2fr] sm:gap-md"
            >
              <div>
                <h2 className="font-heading text-h3 font-semibold text-text-primary">
                  {isSafeHref(org.url) ? (
                    <a href={org.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {org.name}
                    </a>
                  ) : (
                    org.name
                  )}
                </h2>
                {/* The scale step owns the tracking (tailwind.config.js
                    fontStep), so no raw tracking utility fights it. */}
                {org.tier ? (
                  <p className="mt-2xs font-data text-caption uppercase text-text-secondary">
                    {org.tier}
                  </p>
                ) : null}
              </div>
              {org.description ? (
                <p
                  className="mt-xs max-w-prose text-body text-text-secondary sm:mt-0"
                  style={{ textWrap: 'pretty' }}
                >
                  {org.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SystemPage>
  );
}
