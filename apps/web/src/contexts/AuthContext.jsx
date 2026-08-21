// AuthProvider — Firebase auth state plus the two sign-in paths (issue #11,
// spec §9 "Google + OTP only"):
//
//   • signInWithGoogle() — Google popup via the Firebase client SDK.
//   • sendOtpCode(email) / verifyOtpCode({ challengeId, email, code }) — the
//     emailed six-digit code flow against the deployed HTTP endpoints in
//     functions/src/auth/otp.cjs:
//       sendOtpCode    { email } → { challengeId, expiresInMinutes }
//       verifyOtpCode  { challengeId, email, code } → { token }
//     verifyOtpCode() finishes with signInWithCustomToken, so a successful
//     call lands in the same onAuthStateChanged stream as Google.
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
// isAdmin: config/bootstrap.adminEmails is server-only (firestore.rules), so
// the client cannot read the allowlist. It learns admin-ness by probing one
// admin-only read (cmsContent_drafts, limit 1): the rules' isAdmin() decides,
// the flag is UI convenience only — never an authorization boundary.
// `adminStatus` ('unknown' | 'admin' | 'denied') is the same answer with its
// in-flight state kept: `loading` reports the auth handshake, which finishes
// before the probe does, so a consumer that must not render a denial
// prematurely waits on adminStatus === 'unknown' instead.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { appCheckHeaders, auth, db } from '../firebase.js';

const AuthContext = createContext(null);

/** Base URL for the deployed HTTP functions (see module comment). */
export function functionsOrigin() {
  const override = import.meta.env.VITE_FUNCTIONS_ORIGIN;
  if (override) return override.replace(/\/+$/, '');
  const region = import.meta.env.VITE_FIREBASE_REGION || 'us-central1';
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!project) {
    // A deploy missing this env var would otherwise silently fetch
    // us-central1-undefined.cloudfunctions.net and surface as a mystery
    // network error at sign-in time — fail loudly and specifically instead.
    console.error(
      'VITE_FIREBASE_PROJECT_ID is not set; cannot build the functions origin.',
    );
  }
  return `https://${region}-${project}.cloudfunctions.net`;
}

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
          : 'Something went wrong. Try again.',
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
  // 'unknown' until the probe below answers for the current user: `loading`
  // covers the auth handshake only, and it goes false the moment
  // onAuthStateChanged fires — while the probe is still in flight. A gate
  // that read isAdmin at that instant would show "not an admin" to an admin
  // for a tick, so the tri-state is exposed alongside the boolean.
  const [adminStatus, setAdminStatus] = useState('unknown'); // 'unknown'|'admin'|'denied'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  // Admin probe (see module comment). Runs once per signed-in user; a
  // permission-denied answer simply means "not an admin".
  useEffect(() => {
    if (!user) {
      setAdminStatus('denied');
      return undefined;
    }
    let cancelled = false;
    // A new user means the previous answer no longer applies; go back to
    // 'unknown' so consumers wait rather than reusing a stale verdict.
    setAdminStatus('unknown');
    (async () => {
      try {
        await getDocs(query(collection(db, 'cmsContent_drafts'), limit(1)));
        if (!cancelled) setAdminStatus('admin');
      } catch {
        if (!cancelled) setAdminStatus('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isAdmin = adminStatus === 'admin';

  const signInWithGoogle = useCallback(
    () => signInWithPopup(auth, new GoogleAuthProvider()),
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
    const { token } = await postJson('verifyOtpCode', {
      challengeId,
      email,
      code,
    });
    return signInWithCustomToken(auth, token);
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const value = useMemo(
    () => ({
      user,
      isAdmin,
      adminStatus,
      loading,
      signInWithGoogle,
      sendOtpCode,
      verifyOtpCode,
      signOut,
    }),
    [
      user,
      isAdmin,
      adminStatus,
      loading,
      signInWithGoogle,
      sendOtpCode,
      verifyOtpCode,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}

export default AuthContext;
