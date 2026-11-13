// The signed-in attendee's home (issue #168, CJS parity M8 issue 7).
//
// The cards own their account, schedule, reply-notification and event data.
// The shell arranges them and carries no data or subscriptions itself.
import { Link, useOutletContext } from 'react-router';
import AdminEntryLink from '../components/AdminEntryLink.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';
import ProfileSidebar from '../components/ProfileSidebar.jsx';
import RegistrationReminderCard from '../components/RegistrationReminderCard.jsx';
import MySessionsCard from '../components/dashboard/MySessionsCard.jsx';
import NotificationInbox from '../components/dashboard/NotificationInbox.jsx';
import ResourceCards from '../components/dashboard/ResourceCards.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

export default function Dashboard() {
  const accountViews = useOutletContext();
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
        <AdminEntryLink account={accountViews} />
      </header>

      {/* Account cards share the responsive grid. Each card hides itself
          when its feature or the current account's access is unavailable. */}
      <div className="mt-xl grid items-start gap-lg lg:grid-cols-2">
        {/* Draws nothing unless questions are still unanswered (ADR 0008 §5). */}
        <RegistrationReminderCard />
        <MySessionsCard />
        <NotificationInbox />
        <ProfileSidebar />
        {features.liveUpdates ? (
          <div className="min-w-0">
            <LiveUpdatesCard />
          </div>
        ) : null}
      </div>

      {/* The event's own pages, one card each (issue #169). The row renders
          nothing when none of the pages exist, so it never offers a dead
          end. */}
      <div className="mt-xl">
        <ResourceCards />
      </div>
    </article>
  );
}
