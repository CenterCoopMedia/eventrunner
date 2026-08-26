// Speaker invite acceptance (issue #21, spec §4.3 / §9).
//
// The page a speaker lands on from their invitation email. Three phases,
// and the middle one is why this is not just a button:
//
//   1. Check the link — POST validateSpeakerInvite with the ?token= from the
//      URL. The server answers 200 for a miss as well as a hit (one status
//      code for every outcome, so a network log is not an oracle), so the
//      branch is on `valid`, never on the HTTP status.
//   2. Sign in — acceptance needs an authenticated uid, because §9 retires
//      magic links entirely: the invitation is a claim ticket presented BY an
//      account, not a credential that signs anybody in. The form is the SAME
//      components/SignInPanel.jsx /signin mounts, which is what §9 means by
//      "the email path becomes request-code/enter-code".
//   3. Accept — POST acceptSpeakerInvite with the ID token. The server links
//      users.speakerId ↔ speakers.uid inside one transaction (§4.3 seam #3)
//      and burns the token.
//
// Signing in does not accept anything on its own. The click is the consent,
// and it is deliberately separate from the sign-in: a speaker who reaches
// this page signed in as the wrong account must be able to see WHICH account
// before they bind an invitation to it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import {
  SpeakerInviteError,
  acceptSpeakerInvite,
  validateSpeakerInvite,
} from '../lib/speakerInvites.js';
import { IS_DEMO } from '../lib/demoMode.js';

const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand ' +
  'bg-brand-primary px-4 py-2 font-semibold text-brand-surface ' +
  'hover:bg-brand-primary-dark disabled:opacity-60';

const secondaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand ' +
  'border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold ' +
  'text-brand-ink hover:bg-brand-surface-alt disabled:opacity-60';

const Panel = ({ children }) => (
  <div className="mt-6 space-y-4 rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-6">
    {children}
  </div>
);

/**
 * Static demo build only (lib/demoMode.js). Says what this page does on a
 * real deployment rather than claiming the visitor's link is expired or
 * invalid — nothing about it was checked, and pretending otherwise would be
 * the one demo state that reads as a bug.
 */
function DemoInviteNotice() {
  return (
    <article className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold text-brand-ink">Your invitation</h1>
      <Panel>
        <p className="font-heading text-lg font-semibold text-brand-ink">
          Invitations are disabled in this demo
        </p>
        <p className="text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
          On a real deployment this page checks the invitation link an
          organizer emailed you, then links it to the account you sign in
          with. This is a read-only tour of a fictional event, so no
          invitation is checked and nothing leaves your browser.
        </p>
        <Link to="/" className={primaryButtonClass}>
          Back to the event
        </Link>
      </Panel>
    </article>
  );
}

export default function SpeakerAccept() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { user, loading, signOut } = useAuth();

  const [check, setCheck] = useState({ state: 'checking', invite: null, reason: null });
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(null); // the server's success payload
  const [error, setError] = useState(null); // { code, message }
  const errorRef = useRef(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    // Static demo build (lib/demoMode.js): every other read path in the app
    // is inert because Firestore is offline, but validating an invitation is
    // a plain POST to the functions origin, which nothing else switches off.
    // The token comes from the URL, so merely opening a shared
    // /speaker/accept?token=… link in the demo would send it offsite. Never
    // call out; DemoInviteNotice below is what renders instead. In a normal
    // client build IS_DEMO is a compile-time `false` and this branch is
    // dropped.
    if (IS_DEMO) return undefined;
    if (!token) {
      setCheck({ state: 'invalid', invite: null, reason: 'missing' });
      return undefined;
    }
    let cancelled = false;
    setCheck({ state: 'checking', invite: null, reason: null });
    (async () => {
      try {
        const result = await validateSpeakerInvite(token);
        if (cancelled) return;
        if (result?.valid) {
          setCheck({ state: 'valid', invite: result, reason: null });
        } else {
          setCheck({
            state: result?.reason === 'expired' ? 'expired' : 'invalid',
            invite: null,
            reason: result?.reason ?? 'invalid',
          });
        }
      } catch (err) {
        if (cancelled) return;
        // A network failure is NOT an invalid link — telling a speaker their
        // invitation is bad because their train went through a tunnel is the
        // one error here they cannot recover from on their own.
        setCheck({ state: 'unreachable', invite: null, reason: err?.code ?? 'network' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = useCallback(async () => {
    setError(null);
    setAccepting(true);
    try {
      const idToken = await user.getIdToken();
      const result = await acceptSpeakerInvite({ token, idToken });
      setAccepted(result);
    } catch (err) {
      setError({
        code: err instanceof SpeakerInviteError ? err.code : 'unknown',
        message:
          err instanceof SpeakerInviteError
            ? err.message
            : 'Something went wrong. Try again.',
        invitedEmailMasked:
          err instanceof SpeakerInviteError ? err.invitedEmailMasked : null,
      });
      // An expired or already-used invitation is a fact about the link, not
      // about this attempt: move the whole page into that state so the
      // speaker gets the "ask for a new one" copy instead of a retry button
      // that can never succeed.
      if (err?.code === 'invite-expired') {
        setCheck({ state: 'expired', invite: null, reason: 'expired' });
      } else if (err?.code === 'invite-invalid') {
        setCheck({ state: 'invalid', invite: null, reason: 'invalid' });
      }
    } finally {
      setAccepting(false);
    }
  }, [token, user]);

  // Every hook above has run, so this early return is safe — and it must
  // come before the `checking` branch below, because the demo never leaves
  // that state: the effect returns without validating anything, so the page
  // would otherwise sit on the spinner forever.
  //
  // Written as a bare `IS_DEMO` test rather than a branch on `check.state`
  // so the bundler can fold it: with the flag unset the condition is a
  // literal `false`, the branch goes, and DemoInviteNotice becomes an
  // unreferenced top-level function that tree-shakes out — the same shape,
  // and the same reason, as components/SignInPanel.jsx's DemoSignInNotice.
  if (IS_DEMO) return <DemoInviteNotice />;

  if (loading || check.state === 'checking') {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Your invitation</h1>
        <div className="mt-6">
          <LoadingState label="Checking your invitation…" />
        </div>
      </article>
    );
  }

  if (check.state === 'unreachable') {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Your invitation</h1>
        <EmptyState
          title="We could not check your invitation"
          description="This looks like a connection problem rather than a problem with your link. Check your connection and reload this page."
        />
      </article>
    );
  }

  if (check.state === 'expired') {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Your invitation</h1>
        <EmptyState
          title="This invitation has expired"
          description="Invitation links stop working after two weeks. Ask the organizers to send you a new one — nothing is lost, and the new link works the same way."
        />
      </article>
    );
  }

  if (check.state === 'invalid') {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Your invitation</h1>
        <EmptyState
          title="This invitation link is not valid"
          description="It may have already been used, been replaced by a newer invitation, or been copied incompletely. Ask the organizers to send you a new one."
        />
      </article>
    );
  }

  if (accepted) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">You are confirmed</h1>
        <Panel>
          <p role="status" className="text-brand-ink">
            Thank you{accepted.speakerName ? `, ${accepted.speakerName}` : ''} — your
            invitation is accepted and linked to this account.
          </p>
          {/* /speaker/profile is the wizard (issue #22): it edits the
              CANONICAL speaker record an organizer approves, not /profile
              (the attendee users/{uid} record) — same route
              speaker.accepted's email CTA now points at
              (functions/src/speakers/invites.cjs). */}
          <p className="text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
            Next, write your speaker profile — your biography, photograph, and
            organization — for the public programme. It appears publicly once
            an organizer has reviewed it.
          </p>
          <Link to="/speaker/profile" className={primaryButtonClass}>
            Write your speaker profile
          </Link>
        </Panel>
      </article>
    );
  }

  const invite = check.invite;

  return (
    <article className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold text-brand-ink">Your invitation</h1>
      <p className="mt-2 text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
        {invite.speakerName ? `${invite.speakerName}, you` : 'You'} are invited to
        take part as a {invite.inviteType || 'speaker'}.
        {invite.invitedEmailMasked
          ? ` We sent this invitation to ${invite.invitedEmailMasked}.`
          : ''}
      </p>

      {user ? (
        <Panel>
          <p className="text-brand-ink">
            You are signed in{user.email ? ` as ${user.email}` : ''}.
          </p>
          {error ? (
            <p
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="flex items-start gap-2 rounded-brand border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              <span aria-hidden="true" className="font-semibold">
                !
              </span>
              <span>{error.message}</span>
            </p>
          ) : null}
          {/* The invited address is an authorization boundary, not a
              preference (functions/src/speakers/invites.cjs): the server
              refuses to link an account at any other address, because a
              forwarded invitation would otherwise let whoever holds the
              link claim the speaker record and the access that comes with
              it. So the wrong-account case gets the instruction that
              actually resolves it rather than a retry button that cannot
              succeed — sign in at the invited inbox, which the emailed code
              does without a password. */}
          {error?.code === 'email-mismatch' ? (
            <div className="space-y-3">
              <p className="text-brand-ink" style={{ textWrap: 'pretty' }}>
                Sign in with{' '}
                {error.invitedEmailMasked ? (
                  <strong>{error.invitedEmailMasked}</strong>
                ) : (
                  'the invited address'
                )}{' '}
                — ask for a sign-in code at that address, or use a Google
                account there. If you would rather use this account, ask the
                organizers to re-send the invitation to it.
              </p>
              <button type="button" onClick={() => signOut()} className={primaryButtonClass}>
                Sign in with the invited address
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={accept}
                disabled={accepting}
                className={primaryButtonClass}
              >
                {accepting ? 'Accepting…' : 'Accept the invitation'}
              </button>
              {/* The way out of link-occupied and of "wrong account"
                  generally: the account is the thing that has to change, and
                  signing out here keeps the token in the URL so the page
                  comes straight back to this step. */}
              <button type="button" onClick={() => signOut()} className={secondaryButtonClass}>
                Use a different account
              </button>
            </>
          )}
        </Panel>
      ) : (
        <>
          <p className="mt-4 text-brand-ink" style={{ textWrap: 'pretty' }}>
            Sign in with the address this invitation was sent to
            {invite.invitedEmailMasked ? ` (${invite.invitedEmailMasked})` : ''} to
            accept it. The quickest way is a one-time code emailed to that
            address — no password needed.
          </p>
          <div className="mt-4">
            <SignInPanel />
          </div>
        </>
      )}
    </article>
  );
}
