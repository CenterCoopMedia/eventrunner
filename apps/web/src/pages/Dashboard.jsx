// The signed-in attendee's home (issue #168, CJS parity M8 issue 7).
//
// ONE PLACE THAT ANSWERS "WHERE DO I STAND". A signed-in attendee reaches
// /dashboard from the header's account control and sees their name, their
// registration status, the way back to their profile form, and whatever the
// event is saying right now. Everything on the page reads records that
// already exist — the account document via ProfileSidebar, the live
// updates feed via its card — so the shell carries no data of its own and
// no new collections.
//
// The two cards are the ones the site already draws: ProfileSidebar is the
// one place an attendee sees their own status (spec §4.1 keeps registration
// out of the public projection, so it stays on this side of sign-in), and
// LiveUpdatesCard renders nothing at all when the feed is empty or the
// flag is off, so an event that says nothing live shows no dead frame.
//
// Later M8 work lands its own cards here (the personal schedule, the
// resource cards); this shell stays out of their way.
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const { features } = useEventConfig();
  const { profile, status } = useProfile();

  if (authLoading || status === 'pending-account') {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading your dashboard…" />
      </div>
    );
  }

  if (!user) {
    return (
      <EmptyState
        title="Sign in to see your dashboard"
        description="Your dashboard gathers your registration status, your sessions, and the event’s updates in one place."
        action={
          <Link to="/signin" className={primaryActionClass}>
            Sign in
          </Link>
        }
      />
    );
  }

  return (
    <article>
      <header>
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Dashboard</h1>
        {/* The account's own name, exactly as the profile carries it: a
            person whose profile is not complete yet still gets the
            greeting, because the dashboard is where they are sent to fix
            that. */}
        <p className="mt-xs max-w-prose text-body text-text-secondary">
          Welcome back{profile?.displayName ? `, ${profile.displayName}` : ''}. This is your
          place at the event.
        </p>
      </header>

      {/* The status card and the live feed side by side where there is
          room; the feed is the one that yields, because the status is the
          reason the reader came. LiveUpdatesCard renders nothing when the
          event has no feed, so an event without updates shows one card. */}
      <div className="mt-xl grid items-start gap-lg lg:grid-cols-2">
        <ProfileSidebar />
        {features.liveUpdates ? (
          <div className="min-w-0">
            <LiveUpdatesCard />
          </div>
        ) : null}
      </div>
    </article>
  );
}
