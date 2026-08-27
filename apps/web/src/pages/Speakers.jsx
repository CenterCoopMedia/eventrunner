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
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  return (
    <article>
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Speakers</h1>
      {speakers.length === 0 ? (
        <div className="mt-lg">
          <EmptyState
            title="Speakers have not been announced yet"
            description="Speaker profiles appear here once they are published."
          />
        </div>
      ) : (
        // A ruled directory, not a card grid (design brief §2.1, §5.1): one
        // hairline-separated entry per speaker, the name in the heading face
        // and the affiliation in the data face beside it. A rule replaces
        // the card border, so nothing here is boxed.
        <ul className="mt-lg">
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
                className="border-t-hairline border-t-rule-hairline py-md sm:grid sm:grid-cols-[1fr,2fr] sm:gap-md"
              >
                <div>
                  <Link to={href} className="flex items-baseline gap-xs hover:underline">
                    {speaker.headshotPath ? (
                      <AssetImage
                        path={speaker.headshotPath}
                        alt=""
                        className="h-10 w-10 shrink-0 self-center rounded-brand bg-surface object-cover"
                      />
                    ) : null}
                    <h2 className="font-heading text-h3 font-semibold text-text-primary">
                      {speaker.displayName}
                    </h2>
                  </Link>
                  {affiliation ? (
                    <p className="mt-2xs font-data text-caption text-text-secondary">
                      {affiliation}
                    </p>
                  ) : null}
                </div>
                {speaker.bio ? (
                  <p
                    className="mt-xs max-w-prose text-body text-text-secondary sm:mt-0"
                    style={{ textWrap: 'pretty' }}
                  >
                    {speaker.bio}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
