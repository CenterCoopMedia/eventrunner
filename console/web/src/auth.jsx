// Sign-in for the console (ADR 0007 §2): Google, Microsoft, or a link sent
// by email. Pages read the user and the methods from AuthContext, so a
// test gives them a fake context and never starts the Firebase SDK.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider, OAuthProvider, isSignInWithEmailLink, onIdTokenChanged,
  sendSignInLinkToEmail, signInWithEmailLink, signInWithPopup, signOut,
} from 'firebase/auth';
import { auth } from './firebase.js';

/** The address an email link was sent to, kept until the link is opened. */
export const EMAIL_KEY = 'console.emailForSignIn';
/** Where to go after sign-in (a path in this app). */
export const RETURN_KEY = 'console.returnTo';

export const AuthContext = createContext(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

function store(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage. The reader then types the
    // address again on the finish page.
  }
}

export function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rememberReturn(path) {
  store(RETURN_KEY, path);
}

/**
 * The saved return path; only a path inside this app. Reading does not
 * clear it, so a second render gets the same answer. Layout clears it
 * once the reader is signed in and has left the sign-in pages.
 */
export function peekReturn(href) {
  return localPath(readStored(RETURN_KEY)) || localPath(nextFrom(href)) || '/';
}

function localPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

/**
 * The return path an emailed sign-in link carries. Another tab, or another
 * browser, can finish the sign-in after the saved path is gone.
 */
function nextFrom(href) {
  try {
    return href ? new URL(href).searchParams.get('next') : null;
  } catch {
    return null;
  }
}

export function forgetReturn() {
  store(RETURN_KEY, null);
}

const MESSAGES = {
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/account-exists-with-different-credential':
    'You used another sign-in method with this email address before. Use that method, or get a sign-in link by email.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/invalid-action-code': 'This sign-in link has expired or was already used. Get a new link.',
  'auth/expired-action-code': 'This sign-in link has expired or was already used. Get a new link.',
  'auth/network-request-failed': 'We could not reach the server. Check your connection and try again.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
};

/** A plain message for a sign-in error, or '' when there is nothing to say. */
export function signInErrorMessage(error) {
  const code = error?.code;
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, code)) return MESSAGES[code];
  return 'Sign-in did not work. Try again.';
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, ready: false });

  // Not onAuthStateChanged: it stays quiet when the uid does not change, as when an
  // emailed link confirms an open session, and that reader would never get past confirming.
  useEffect(() => onIdTokenChanged(auth, (user) => setState({ user, ready: true })), []);

  const value = useMemo(() => ({
    ...state,
    async signInWithGoogle() {
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    async signInWithMicrosoft() {
      await signInWithPopup(auth, new OAuthProvider('microsoft.com'));
    },
    async sendEmailLink(rawEmail) {
      const email = String(rawEmail).trim().toLowerCase();
      // The path only: a link's #token stays out of the query string, so the
      // reader reopens the emailed signup or invite link for it.
      const next = localPath(readStored(RETURN_KEY))?.split('#')[0];
      await sendSignInLinkToEmail(auth, email, {
        url: `${window.location.origin}/signin/finish${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`,
        handleCodeInApp: true,
      });
      store(EMAIL_KEY, email);
    },
    isEmailLink(href) {
      return isSignInWithEmailLink(auth, href);
    },
    async finishEmailLink(email, href) {
      await signInWithEmailLink(auth, String(email).trim().toLowerCase(), href);
      store(EMAIL_KEY, null);
    },
    async signOut() {
      await signOut(auth);
    },
  }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
