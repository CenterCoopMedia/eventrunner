// Speakers page — the public directory, rendered from the `speakers_public`
// projection (spec §4.3). Every field here is one the projection carries;
// the canonical `speakers/{id}` record (email, uid, inviteToken, pipeline
// status) is server-only and never reaches this bundle, and a speaker who
// is not `approved` has no projection at all — which is why there is no
// visibility filter to apply.
// Each card links to /speakers/:slug (SpeakerDetail.jsx, issue #22) — the
// slug is stored on the projection itself (buildPublicSpeaker always
// derives one), so no extra lookup is needed to build the link.
// Feature-gated by config/features.speakers — the nav link already hides
// when the feature is off, but the route itself must gate too, since direct
// navigation bypasses the nav (matches the Schedule.jsx pattern).
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AssetImage from '../components/media/AssetImage.jsx';

export default function Speakers() {
  const { features } = useEventConfig();
  const { speakers } = useContent();

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
      {speakers.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Speakers have not been announced yet"
            description="Speaker profiles appear here once they are published."
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {speakers.map((speaker) => {
            // jobTitle and organization are separate canonical fields, not
            // the one free-text "Role, Organization" string the old
            // name-joined store carried. Either may be blank.
            const affiliation = [speaker.jobTitle, speaker.organization]
              .filter(Boolean)
              .join(', ');
            const href = `/speakers/${typeof speaker.slug === 'string' && speaker.slug ? speaker.slug : speaker.id}`;
            return (
              <li
                key={speaker.id}
                className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
              >
                <Link to={href} className="flex items-start gap-3 hover:underline">
                  {speaker.headshotPath ? (
                    <AssetImage
                      path={speaker.headshotPath}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full bg-brand-surface object-cover"
                    />
                  ) : null}
                  <h2 className="font-heading text-lg text-brand-ink">{speaker.displayName}</h2>
                </Link>
                {affiliation ? (
                  <p className="mt-1 text-sm text-brand-ink-muted">{affiliation}</p>
                ) : null}
                {speaker.bio ? <p className="mt-2 text-brand-ink-muted">{speaker.bio}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
