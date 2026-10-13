import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { getDocs } from 'firebase/firestore';
import { auth } from '../firebase.js';
import { AuthProvider, useAuth } from './AuthContext.jsx';

const UNVERIFIED = { uid: 'existing-attendee', email: 'attendee@example.test', emailVerified: false };
let authListener;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function publishAuth(nextUser) {
  auth.currentUser = nextUser;
  authListener(nextUser);
}

// Match the installed SDK: replacing the user with the same UID does not
// notify onAuthStateChanged, even though auth.currentUser is a new object.
function customTokenResult(nextUser) {
  const previousUid = auth.currentUser?.uid;
  auth.currentUser = nextUser;
  if (previousUid !== nextUser.uid) authListener(nextUser);
  return { user: nextUser };
}

function AuthConsumer() {
  const { user, adminStatus, adminTier, verifyOtpCode, signOut } = useAuth();
  const [result, setResult] = useState('waiting');
  return <>
    <output aria-label="Account">{user ? `${user.uid}: ${user.emailVerified ? 'verified' : 'unverified'}` : 'signed out'}</output>
    <output aria-label="Admin access">{adminStatus}: {adminTier || 'none'}</output>
    <output aria-label="OTP result">{result}</output>
    <button type="button" onClick={async () => {
      try {
        const credential = await verifyOtpCode({ challengeId: 'challenge', email: UNVERIFIED.email, code: '123456' });
        setResult(`complete: ${credential.user.uid}`);
      } catch (error) { setResult(error.message); }
    }}>Verify emailed code</button>
    <button type="button" onClick={signOut}>Sign out</button>
  </>;
}

function renderAuth() { return render(<AuthProvider><AuthConsumer /></AuthProvider>); }
function verify() { fireEvent.click(screen.getByRole('button', { name: 'Verify emailed code' })); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 'verified-custom-token' }) })));
  auth.currentUser = { ...UNVERIFIED };
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, listener) => {
    authListener = listener;
    listener(auth.currentUser);
    return () => {};
  });
  vi.mocked(signInWithCustomToken).mockReset();
  vi.mocked(firebaseSignOut).mockImplementation(async () => publishAuth(null));
  vi.mocked(getDocs).mockReset().mockResolvedValue({ docs: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete auth.currentUser;
});

describe('same-account OTP credential refresh', () => {
  it('updates the rendered verification state when Firebase replaces the same UID without an auth-state event', async () => {
    const verified = { ...UNVERIFIED, emailVerified: true };
    vi.mocked(signInWithCustomToken).mockImplementation(async () => customTokenResult(verified));
    renderAuth();
    expect(screen.getByLabelText('Account')).toHaveTextContent('existing-attendee: unverified');
    verify();
    await waitFor(() => expect(screen.getByLabelText('OTP result')).toHaveTextContent('complete: existing-attendee'));
    expect(screen.getByLabelText('Account')).toHaveTextContent('existing-attendee: verified');
    expect(auth.currentUser).toBe(verified);
    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('rechecks admin authority for the refreshed user and keeps the tier unknown until both probes answer', async () => {
    const verified = { ...UNVERIFIED, emailVerified: true };
    const drafts = deferred();
    const logs = deferred();
    vi.mocked(signInWithCustomToken).mockImplementation(async () => customTokenResult(verified));
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText('Admin access')).toHaveTextContent('admin: operator'));
    vi.mocked(getDocs).mockImplementation((query) => query.ref.path === 'cmsContent_drafts' ? drafts.promise : logs.promise);
    verify();
    await waitFor(() => expect(screen.getByLabelText('OTP result')).toHaveTextContent('complete: existing-attendee'));
    expect(screen.getByLabelText('Account')).toHaveTextContent('existing-attendee: verified');
    expect(screen.getByLabelText('Admin access')).toHaveTextContent('unknown: none');
    await act(async () => drafts.resolve({ docs: [] }));
    expect(screen.getByLabelText('Admin access')).toHaveTextContent('unknown: none');
    await act(async () => logs.reject(Object.assign(new Error('Not allowed.'), { code: 'permission-denied' })));
    expect(screen.getByLabelText('Admin access')).toHaveTextContent('admin: staff');
    expect(getDocs).toHaveBeenCalledTimes(4);
  });

  it('does not restore a credential after sign-out completes while the SDK result is pending', async () => {
    const pending = deferred();
    const verified = { ...UNVERIFIED, emailVerified: true };
    vi.mocked(signInWithCustomToken).mockReturnValue(pending.promise);
    renderAuth();
    verify();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByLabelText('Account')).toHaveTextContent('signed out'));
    await act(async () => pending.resolve({ user: verified }));
    expect(screen.getByLabelText('Account')).toHaveTextContent('signed out');
    expect(screen.getByLabelText('Admin access')).toHaveTextContent('denied: none');
    expect(auth.currentUser).toBeNull();
  });

  it('does not overwrite an account switch with an older OTP credential', async () => {
    const pending = deferred();
    const replacement = { uid: 'other-attendee', emailVerified: false };
    vi.mocked(signInWithCustomToken).mockReturnValue(pending.promise);
    renderAuth();
    verify();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledTimes(1));
    await act(async () => publishAuth(replacement));
    await act(async () => pending.resolve({ user: { ...UNVERIFIED, emailVerified: true } }));
    expect(screen.getByLabelText('Account')).toHaveTextContent('other-attendee: unverified');
    expect(auth.currentUser).toBe(replacement);
  });

  it('ignores a stale result when the SDK already holds a newer object for the same UID', async () => {
    const pending = deferred();
    const newer = { ...UNVERIFIED };
    vi.mocked(signInWithCustomToken).mockReturnValue(pending.promise);
    renderAuth();
    verify();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledTimes(1));
    auth.currentUser = newer;
    await act(async () => pending.resolve({ user: { ...UNVERIFIED, emailVerified: true } }));
    expect(screen.getByLabelText('Account')).toHaveTextContent('existing-attendee: unverified');
    expect(auth.currentUser).toBe(newer);
  });

  it('leaves different-UID sign-in on the existing auth listener without duplicate access probes', async () => {
    auth.currentUser = null;
    const verified = { uid: 'new-attendee', emailVerified: true };
    vi.mocked(signInWithCustomToken).mockImplementation(async () => customTokenResult(verified));
    renderAuth();
    verify();
    await waitFor(() => expect(screen.getByLabelText('OTP result')).toHaveTextContent('complete: new-attendee'));
    expect(screen.getByLabelText('Account')).toHaveTextContent('new-attendee: verified');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('does not invent verification when the returned Firebase user remains unverified', async () => {
    vi.mocked(signInWithCustomToken).mockImplementation(async () => customTokenResult({ ...UNVERIFIED }));
    renderAuth();
    verify();
    await waitFor(() => expect(screen.getByLabelText('OTP result')).toHaveTextContent('complete: existing-attendee'));
    expect(screen.getByLabelText('Account')).toHaveTextContent('existing-attendee: unverified');
  });
});
