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
import SystemPage from '../components/SystemPage.jsx';
import SpecimenLabel from '../components/editorial/SpecimenLabel.jsx';
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
    <SystemPage pageId="speakers">
      {({ arrangement }) => (
        <>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">Speakers</h1>
          {speakers.length === 0 ? (
            <div className="mt-lg">
              <EmptyState
                title="Speakers have not been announced yet"
                description="Speaker profiles appear here once they are published."
              />
            </div>
          ) : (
            // A SHELF OF PORTRAITS (design brief §5.1; this review).
            //
            // The headshot used to be a 40px thumbnail beside the name,
            // which is not a picture of anyone — at that size a face is a
            // bullet. This page's job is recognition: a reader is looking
            // for someone they half remember, or working out who is worth
            // an hour of their day. So the portrait leads, at a size a face
            // survives, in a frame on the alternate ground — which also
            // means a speaker with no headshot is an empty frame holding
            // its place on the shelf, not a hole in it.
            //
            // Still not a card. The frame holds the picture and nothing
            // else: no border boxes the entry, the name and the credit sit
            // on the open page under a hairline, and the ink and radius are
            // the house's.
            //
            // `arrangement` (brief §6.1) chooses the shelf's shape and
            // never what it is: `grid` runs the plates in columns, which is
            // what a shelf normally looks like, and `list` gives each
            // portrait its own row with the bio running beside it — the
            // reading a long-form speaker page wants.
            <ul
              className={
                arrangement === 'grid'
                  ? 'portrait-shelf mt-lg grid gap-x-lg sm:grid-cols-2 lg:grid-cols-3'
                  : 'portrait-shelf mt-lg'
              }
            >
              {speakers.map((speaker, index) => {
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
                    className={
                      arrangement === 'grid'
                        ? 'portrait-shelf__plate border-t-hairline border-t-rule-hairline'
                        : 'portrait-shelf__plate border-t-hairline border-t-rule-hairline sm:grid sm:grid-cols-[14rem,1fr] sm:gap-lg'
                    }
                  >
                    {/* The portrait is decorative here: the name is right
                        under it and links to the same place, so alt text
                        would be the name said twice to a screen reader. */}
                    <div className="portrait-shelf__frame">
                      {speaker.headshotPath ? (
                        <AssetImage path={speaker.headshotPath} alt="" className="" />
                      ) : null}
                    </div>
                    <div className={arrangement === 'grid' ? 'mt-xs' : 'mt-xs sm:mt-0'}>
                      <h2 className="font-heading text-h3 font-semibold text-text-primary">
                        <Link to={href} className="hover:underline">
                          {speaker.displayName}
                        </Link>
                      </h2>
                      {/* The credit line as a specimen label (visual story,
                          Field Guide, moment 2): the shelf reads as the
                          plates of a collection rather than a grid of
                          profile cards. The pencil line goes under the
                          FIRST entry only — "at most one per page" — and it
                          is off until a client turns marginalia on. */}
                      <SpecimenLabel
                        className="mt-2xs"
                        pencil={index === 0}
                        fields={[{ key: 'Affiliation', value: affiliation }]}
                      />
                      {speaker.bio ? (
                        <p
                          className="mt-xs max-w-prose text-body text-text-secondary"
                          style={{ textWrap: 'pretty' }}
                        >
                          {speaker.bio}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </SystemPage>
  );
}
