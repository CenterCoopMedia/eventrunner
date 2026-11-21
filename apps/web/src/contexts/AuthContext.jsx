// AuthProvider — Firebase auth state plus the two sign-in paths (issue #11,
// spec §9 "Google + OTP only"):
//
//   • signInWithGoogle() — Google popup via the Firebase client SDK.
//   • sendOtpCode(email) / verifyOtpCode({ challengeId, email, code }) — the
//     emailed six-digit code flow against the deployed HTTP endpoints in
//     functions/src/auth/otp.cjs:
//       sendOtpCode    { email } → { challengeId, expiresInMinutes }
//       verifyOtpCode  { challengeId, email, code } → { token }
//     verifyOtpCode() finishes with signInWithCustomToken. UID changes use
//     the same onAuthStateChanged stream as Google; a refreshed same-UID
//     credential also updates the context because Firebase suppresses that
//     auth-state event.
//
// Function URL convention (spec §2.4 / §8.1 — no hardcoded probe URLs):
//   https://<region>-<project>.cloudfunctions.net/<name>
// derived from VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_REGION (default
// us-central1). VITE_FUNCTIONS_ORIGIN overrides the whole origin — point it
// at the Functions emulator, e.g.
//   VITE_FUNCTIONS_ORIGIN=http://127.0.0.1:5001/<project>/<region>
//
// App Check (issue #45): both OTP calls carry an X-Firebase-AppCheck header
// when VITE_FIREBASE_APP_CHECK_SITE_KEY is configured (see firebase.js). With
// no key the header is absent and nothing changes; the server only requires it
// when the deployment sets EVENT_APP_CHECK_ENFORCED=true.
//
// isAdmin: config/bootstrap is server-only (firestore.rules), so the client
// cannot read either allowlist. It learns admin-ness by probing one
// admin-only read (cmsContent_drafts, limit 1): the rules' isAdmin() decides,
// the flag is UI convenience only — never an authorization boundary.
// `adminStatus` ('unknown' | 'admin' | 'denied') is the same answer with its
// in-flight state kept: `loading` reports the auth handshake, which finishes
// before the probe does, so a consumer that must not render a denial
// prematurely waits on adminStatus === 'unknown' instead.
//
// adminTier (issue #186): the same device answers WHICH tier. A second probe
// reads admin_logs (limit 1), the one client-readable collection the rules
// grant to isOperator() alone; success is 'operator', a refusal is 'staff'.
// Both probes run together and adminStatus stays 'unknown' until both have
// answered, so the docket never draws the staff set and then grows. The
// tier hides out-of-tier sections and refuses their routes in the shell
// (AdminLayout.jsx); the server (requireAdmin's tier option) and the rules
// (isOperator) are the enforcement.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { appCheckHeaders, loadFirebase, subscribeToFirebase, rememberSignedIn } from '../lib/firebaseLoader.js';
import { functionsOrigin } from '../lib/firebaseSettings.js';
import { secondaryButtonClass } from '../components/controlClasses.js';
import { clearLocalDrafts } from '../lib/localDraft.js';
import { reloadPage } from '../lib/pageReload.js';

const AuthContext = createContext(null);

// Firebase reports the first auth state only after its own startup, and that
// startup has no overall time limit: on a phone it loads Google's auth iframe
// script first, and it waits on IndexedDB, which can stop answering (issue
// 1357). After this wait the sign-in page offers its options and a retry.
// The check itself goes on, and its answer replaces that view when it comes.
const SIGN_IN_WAIT_MS = 15_000;

/**
 * Error shape every OTP endpoint failure is normalized to. `code` mirrors the
 * server's error.code ('rate-limited', 'invalid-code', …) plus 'network' for
 * a fetch that never reached the server; `retryAfterSeconds` is set on 429
 * (the server mirrors Retry-After into the body because the header is not
 * CORS-readable).
 */
export class OtpRequestError extends Error {
  constructor({ code, message, status, retryAfterSeconds = null }) {
    super(message);
    this.name = 'OtpRequestError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Every sign-in action waits behind Firebase's startup, which has no time
// limit (issue 1357). Wait for it at most SIGN_IN_WAIT_MS, then fail with a
// message the form shows. Called before the code is sent for checking, so a
// stalled page does not use up the emailed code.
async function authStartup(auth) {
  let timer;
  const stalled = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new OtpRequestError({
      code: 'auth-not-ready',
      status: 0,
      message: 'Sign-in is not ready on this page. Reload the page and try again.',
    })), SIGN_IN_WAIT_MS);
  });
  try {
    await Promise.race([auth.authStateReady(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(name, body) {
  let response;
  // Empty unless App Check is configured for this deployment; the server
  // only requires it when EVENT_APP_CHECK_ENFORCED is on (issue #45).
  const attestation = await appCheckHeaders();
  try {
    response = await fetch(`${functionsOrigin()}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...attestation },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OtpRequestError({
      code: 'network',
      status: 0,
      message:
        'We could not reach the sign-in service. Check your connection and try again.',
    });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null; // non-JSON body (proxy error page); fall through
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new OtpRequestError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message:
        typeof error.message === 'string'
          ? error.message
          : 'The sign-in request could not be confirmed. Try again.',
      retryAfterSeconds:
        typeof error.retryAfterSeconds === 'number'
          ? error.retryAfterSeconds
          : null,
    });
  }
  return payload;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // The probes' answer, kept WITH the user object it was probed for. The
  // exposed adminStatus is derived in render from this pair: a verdict for
  // any other user (a different account, or a refreshed credential for the
  // same UID) reads as 'unknown' in the very render that brings the new
  // user, before any passive effect could reset it. A gate that read the old
  // verdict for one render would let a staff answer for account A authorize
  // account B (issue #788).
  //
  // adminStatus is 'unknown' until the probe answers for the current user:
  // `loading` covers the auth handshake only, and it goes false the moment
  // onAuthStateChanged fires — while the probe is still in flight. A gate
  // that read isAdmin at that instant would show "not an admin" to an admin
  // for a tick, so the tri-state is exposed alongside the boolean.
  //
  // adminTier is null until adminStatus is 'admin'; then 'operator' or
  // 'staff' — or 'unknown' when the tier probe failed for a reason other
  // than permission-denied. Only a permission-denied answer proves staff; a
  // transient failure must not make an operator staff for the session, so
  // it is left unknown, the rail says so and offers a retry, and no section
  // is refused on a guess (the server decides regardless).
  const [verdict, setVerdict] = useState(null);
  const [loading, setLoading] = useState(true);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authWaitEnded, setAuthWaitEnded] = useState(false);
  const retryAuth = useCallback(() => globalThis.location.reload(), []);
  // Refreshing checks the same user again. A failed check returns to loading
  // while it retries. The Access page keeps the current verdict until the
  // new one lands after an operator changes their own standing.
  const [probeRun, setProbeRun] = useState(0);

  useEffect(() => {
    // The Firestore cache and the providers' state are shared by every
    // account in this tab (issue 1017). A sign-out reloads the page, so the
    // next account starts with an empty cache. The signed-out page shown
    // until then reads only public queries. A different account in this
    // document, directly or after a sign-out, is never published: the
    // account tree unmounts and the page reloads.
    let shownUid = null;
    let lastUid = null;
    let switching = false;
    return subscribeToFirebase(({ auth, onAuthStateChanged }) => onAuthStateChanged(auth, (nextUser) => {
      rememberSignedIn(Boolean(nextUser));
      const nextUid = nextUser?.uid ?? null;
      if (switching) return;
      if (nextUid !== null && lastUid !== null && nextUid !== lastUid) {
        switching = true;
        setSwitchingAccount(true);
        reloadPage();
        return;
      }
      if (nextUid === null && shownUid !== null) reloadPage();
      shownUid = nextUid;
      if (nextUid !== null) lastUid = nextUid;
      setUser(nextUser);
      setAuthError(null);
      setLoading(false);
    }), () => setAuthError('Sign-in could not load. Reload this page to try again.'));
  }, []);

  // Only the sign-in page reads authStalled. A protected page keeps waiting
  // for Firebase's answer, so this timeout never reads as signed out.
  useEffect(() => {
    if (!loading) return undefined;
    const timer = window.setTimeout(() => setAuthWaitEnded(true), SIGN_IN_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const authStalled = loading && authWaitEnded;

  // Admin probes (see module comment). Run once per signed-in user, and
  // again on refreshAdminStatus. A permission-denied answer on the first
  // means "not an admin", and on the second "an admin, but not an
  // operator"; any other failure of the second leaves the tier unknown.
  //
  // Only the server's answer counts (issue #1318). With the server
  // unreachable, getDocs resolves from the local cache, and an empty cache
  // answer looks like an allowed read. A cache answer is therefore a failed
  // check: the gate shows "We could not check your admin access" with a
  // retry, never the shell. The one exception is an admin this page session
  // already confirmed with the server: a failed recheck keeps that verdict,
  // so a network blip mid-session does not close the shell, and asks the
  // server again until it answers (see the retry effect below). The server
  // still refuses every admin call it does not authorize.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const probe = (name) => loadFirebase().then(({ db, getDocs, query, collection, limit }) =>
      getDocs(query(collection(db, name), limit(1)))).then(
        (snapshot) => (snapshot?.metadata?.fromCache === false ? 'ok' : 'error'),
        (err) => (err?.code === 'permission-denied' ? 'denied' : 'error'),
      );
    (async () => {
      const [drafts, logs] = await Promise.all([
        probe('cmsContent_drafts'),
        probe('admin_logs'),
      ]);
      if (cancelled) return;
      if (drafts === 'error') {
        setVerdict((current) => (current?.user === user && current.status === 'admin'
          ? { ...current, recheckPending: true }
          : { user, status: 'denied', tier: null, checkFailed: true }));
        return;
      }
      const isAnyAdmin = drafts === 'ok';
      let tier = null;
      if (isAnyAdmin) {
        tier = logs === 'ok' ? 'operator' : logs === 'denied' ? 'staff' : 'unknown';
      }
      setVerdict({
        user,
        status: isAnyAdmin ? 'admin' : 'denied',
        tier,
        checkFailed: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, probeRun]);

  const ownVerdict = user && verdict?.user === user ? verdict : null;
  const adminStatus = !user ? 'denied' : ownVerdict ? ownVerdict.status : 'unknown';
  const adminCheckFailed = ownVerdict?.checkFailed === true;
  const adminTier = ownVerdict?.status === 'admin' ? ownVerdict.tier : null;
  const isAdmin = adminStatus === 'admin';
  const isOperator = adminTier === 'operator';

  // After a failed check, "Check again" first restarts the SDK's network so
  // the probe asks the server now instead of the cache (issue #1329; see
  // reconnectFirestore). Only from the failed-check screen: an admin inside
  // the shell keeps its connection. A failed restart still runs the probe,
  // which fails closed as before.
  const refreshAdminStatus = useCallback(async () => {
    if (adminCheckFailed) {
      setVerdict((current) => current?.checkFailed ? null : current);
      try {
        await (await loadFirebase()).reconnectFirestore();
      } catch { /* The probe below decides. */ }
    }
    setProbeRun((run) => run + 1);
  }, [adminCheckFailed]);

  // A failed check, or a recheck that could not reach the server, is never
  // replaced by the probe effect alone: a staff reader who opened the app
  // offline would wait forever, and a kept admin verdict would outlive a
  // revocation. Ask the server again when the browser reconnects, and every
  // 30 s as a backstop, until it answers. "Check again" asks at once.
  const awaitingServer = adminCheckFailed || ownVerdict?.recheckPending === true;
  useEffect(() => {
    if (!awaitingServer) return undefined;
    const retry = () => setProbeRun((run) => run + 1);
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(timer);
    };
  }, [awaitingServer]);

  const signInWithGoogle = useCallback(
    async () => {
      const { auth, signInWithPopup, GoogleAuthProvider } = await loadFirebase();
      await authStartup(auth);
      return signInWithPopup(auth, new GoogleAuthProvider());
    },
    [],
  );

  // Step 1 of the emailed-code flow. Resolves { challengeId,
  // expiresInMinutes }; throws OtpRequestError (429 carries
  // retryAfterSeconds for the caller's countdown copy).
  const sendOtpCode = useCallback(
    (email) => postJson('sendOtpCode', { email }),
    [],
  );

  // Step 2: one failure shape for every miss (no oracle), then the custom
  // token signs the browser in.
  const verifyOtpCode = useCallback(async ({ challengeId, email, code }) => {
    const { auth, signInWithCustomToken } = await loadFirebase();
    await authStartup(auth);
    const requestUser = auth.currentUser;
    const { token } = await postJson('verifyOtpCode', {
      challengeId,
      email,
      code,
    });
    if (auth.currentUser !== requestUser) {
      throw new OtpRequestError({
        code: 'auth-changed',
        status: 0,
        message: 'Your signed-in account changed. Request a new code to continue.',
      });
    }
    const credential = await signInWithCustomToken(auth, token);
    const refreshedUser = credential?.user;
    if (refreshedUser?.uid) {
      // Same-UID sign-in replaces Firebase's user without an auth-state
      // event. Ignore a returned object once Firebase has moved on to a
      // different user, sign-out, or newer credential.
      setUser((currentUser) => currentUser?.uid === refreshedUser.uid && auth.currentUser === refreshedUser
        ? refreshedUser
        : currentUser);
    }
    return credential;
  }, []);

  const signOut = useCallback(async () => {
    const { auth, signOut } = await loadFirebase();
    clearLocalDrafts(auth.currentUser?.uid ?? user?.uid);
    await signOut(auth);
    rememberSignedIn(false);
  }, [user?.uid]);

  const value = useMemo(
    () => ({
      user,
      isAdmin,
      isOperator,
      adminStatus,
      adminCheckFailed,
      adminTier,
      loading,
      authStalled,
      authError,
      retryAuth,
      refreshAdminStatus,
      signInWithGoogle,
      sendOtpCode,
      verifyOtpCode,
      signOut,
    }),
    [
      user,
      isAdmin,
      isOperator,
      adminStatus,
      adminCheckFailed,
      adminTier,
      loading,
      authStalled,
      authError,
      retryAuth,
      refreshAdminStatus,
      signInWithGoogle,
      sendOtpCode,
      verifyOtpCode,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>
    {authError ? <div role="alert" className="space-y-sm border-hairline border-rule-hairline bg-surface-alt p-md">
      <p>{authError}</p>
      <button type="button" className={secondaryButtonClass} onClick={retryAuth}>Reload this page</button>
    </div> : null}
    {switchingAccount ? <p role="status" className="p-md text-text-secondary">Switching accounts…</p> : children}
  </AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}

export default AuthContext;
