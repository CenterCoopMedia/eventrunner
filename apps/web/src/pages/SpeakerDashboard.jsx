// The signed-in speaker's home (issue #210, CJS parity M12 issue 1).
//
// users/{uid}.speakerId identifies the canonical record, but it does not
// carry the speaker pipeline status. The dashboard reads that status through
// getOwnSpeakerProfile, the same owner-checked endpoint as the profile wizard.
// Only accepted and approved records enter. Every other signed-in account is
// sent to the attendee dashboard; a failed request stays visible and retryable
// because a network error is not evidence that the account is not a speaker.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LiveUpdatesCard from '../components/LiveUpdatesCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import SpeakerSessionHub from '../components/speaker/SpeakerSessionHub.jsx';
import SpeakerStatusHeader from '../components/speaker/SpeakerStatusHeader.jsx';
import { secondaryActionClass } from '../components/controlClasses.js';
import { getOwnSpeakerProfile } from '../lib/speakerProfileApi.js';
import { isSpeakerDashboardEligible } from '../lib/speakerDashboardEligibility.js';

const SPEAKER_STATUS = Object.freeze({
  accepted: {
    label: 'Accepted',
    detail: 'An organizer is reviewing your speaker profile before it appears on the public programme.',
  },
  approved: {
    label: 'Approved',
    detail: 'Your speaker profile is live on the public programme.',
  },
});

const statusCardClass =
  'rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-md';

export default function SpeakerDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { eventConfig, features } = useEventConfig();
  const { scheduleData } = useContent();
  const { profile, status: accountStatus } = useProfile();
  const speakerId = profile?.speakerId ?? null;
  const [load, setLoad] = useState({ status: 'idle', speaker: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user || accountStatus !== 'ready' || !speakerId) return undefined;
    let current = true;
    setLoad({ status: 'loading', speaker: null, error: null });
    getOwnSpeakerProfile({ user, speakerId }).then(
      (speaker) => {
        if (current) setLoad({ status: 'ready', speaker, error: null });
      },
      (error) => {
        if (current) {
          setLoad({
            status: 'error',
            speaker: null,
            error: error?.message || 'Your speaker dashboard could not be loaded.',
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [user, accountStatus, speakerId, attempt]);

  if (authLoading || (user && accountStatus === 'pending-account')) {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading your speaker dashboard…" />
      </div>
    );
  }

  if (!user) {
    // Keep the deep link mounted through authentication. AuthContext updates
    // this branch in place after SignInPanel succeeds, and the dashboard then
    // resumes its owner-checked load without losing the requested URL.
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in to continue</h1>
        <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
          Your speaker dashboard is part of your account. Sign in below to continue where you left off.
        </p>
        <div className="mt-lg">
          <SignInPanel />
        </div>
      </article>
    );
  }
  if (accountStatus === 'ready' && !speakerId) return <Navigate to="/dashboard" replace />;

  if (load.status === 'error') {
    return (
      <EmptyState
        title="Your speaker dashboard could not be loaded"
        description={load.error}
        action={
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className={secondaryActionClass}>
            Try again
          </button>
        }
      />
    );
  }

  if (load.status !== 'ready') {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading your speaker dashboard…" />
      </div>
    );
  }

  if (!isSpeakerDashboardEligible(load.speaker)) return <Navigate to="/dashboard" replace />;
  const status = SPEAKER_STATUS[load.speaker.status];

  const name = [load.speaker.firstName, load.speaker.lastName]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ');

  return (
    <article>
      <header>
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Speaker dashboard</h1>
        <p className="mt-xs max-w-prose text-body text-text-secondary">
          Welcome back{name ? `, ${name}` : ''}. This is your place at the event.
        </p>
      </header>

      <SpeakerStatusHeader
        eventConfig={eventConfig}
        scheduleData={scheduleData}
        speakerId={speakerId}
      />

      <SpeakerSessionHub
        eventConfig={eventConfig}
        scheduleData={scheduleData}
        speakerId={speakerId}
      />

      <div className="mt-xl grid items-start gap-lg lg:grid-cols-2">
        <section aria-labelledby="speaker-status-heading" className={statusCardClass}>
          <h2 id="speaker-status-heading" className="font-heading text-h3 font-semibold text-text-primary">
            Your speaker profile
          </h2>
          <dl className="mt-md font-data text-caption">
            <div>
              <dt className="text-text-secondary">Speaker status</dt>
              <dd className="text-text-primary">{status.label}</dd>
            </div>
          </dl>
          <p className="mt-sm text-body text-text-secondary">{status.detail}</p>
          <Link to="/speaker/profile" className={`${secondaryActionClass} mt-md`}>
            Edit your speaker profile
          </Link>
        </section>

        {features.liveUpdates ? (
          <div className="min-w-0">
            <LiveUpdatesCard />
          </div>
        ) : null}
      </div>
    </article>
  );
}
