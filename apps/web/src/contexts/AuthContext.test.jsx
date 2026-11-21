import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { getDocs } from 'firebase/firestore';
import { auth } from '../firebase.js';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { openLocalDraft } from '../lib/localDraft.js';
import { reloadPage } from '../lib/pageReload.js';

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
      } catch (error) { setResult(`${error.code}: ${error.message}`); }
    }}>Verify emailed code</button>
    <button type="button" onClick={signOut}>Sign out</button>
  </>;
}

function renderAuth() { return render(<AuthProvider><AuthConsumer /></AuthProvider>); }
function verify() { fireEvent.click(screen.getByRole('button', { name: 'Verify emailed code' })); }

beforeEach(() => {
  localStorage.clear();
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
  vi.mocked(getDocs).mockReset().mockResolvedValue({ docs: [], metadata: { fromCache: false } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete auth.currentUser;
});

describe('same-account OTP credential refresh', () => {
  it('clears local drafts on explicit sign-out, while unexpected session loss preserves them', async () => {
    const draft = openLocalDraft(UNVERIFIED.uid, 'cmsPages/faq', 'v1');
    draft.write('Kept text', 'saved');
    renderAuth();
    await act(async () => publishAuth(null));
    expect(draft.read().value).toBe('Kept text');
    await act(async () => publishAuth({ ...UNVERIFIED }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByLabelText('Account')).toHaveTextContent('signed out'));
    expect(draft.read()).toBeNull();
    expect(draft.write('late editor cleanup', 'saved')).toBe(false);
  });

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
    await act(async () => drafts.resolve({ docs: [], metadata: { fromCache: false } }));
    expect(screen.getByLabelText('Admin access')).toHaveTextContent('unknown: none');
    await act(async () => logs.reject(Object.assign(new Error('Not allowed.'), { code: 'permission-denied' })));
    expect(screen.getByLabelText('Admin access')).toHaveTextContent('admin: staff');
    expect(getDocs).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['sign-out', null],
  ])('does not exchange an old OTP token after %s during the HTTP request', async (_action, nextUser) => {
    const pendingHttp = deferred();
    const verified = { ...UNVERIFIED, emailVerified: true };
    vi.mocked(fetch).mockReturnValue(pendingHttp.promise);
    // If called, this mock really replaces the SDK user and emits the
    // UID-changing event. A returned credential alone would miss the race.
    vi.mocked(signInWithCustomToken).mockImplementation(async () => customTokenResult(verified));
    renderAuth();
    verify();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => publishAuth(nextUser));
    await act(async () => pendingHttp.resolve({ ok: true, status: 200, json: async () => ({ token: 'old-custom-token' }) }));
    await waitFor(() => expect(screen.getByLabelText('OTP result')).not.toHaveTextContent('waiting'));
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(auth.currentUser).toBe(nextUser);
    expect(screen.getByLabelText('Account')).toHaveTextContent(nextUser ? 'other-attendee: unverified' : 'signed out');
    expect(screen.getByLabelText('OTP result')).toHaveTextContent('auth-changed: Your signed-in account changed. Request a new code to continue.');
  });

  // These cases guard the React update after Firebase has already changed
  // accounts. They do not simulate cancelling an in-flight SDK exchange.
  it('ignores a stale returned credential after Firebase has already signed out', async () => {
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

  it('ignores a stale returned credential after Firebase has already switched accounts', async () => {
    const pending = deferred();
    const replacement = { uid: 'other-attendee', emailVerified: false };
    vi.mocked(signInWithCustomToken).mockReturnValue(pending.promise);
    renderAuth();
    verify();
    await waitFor(() => expect(signInWithCustomToken).toHaveBeenCalledTimes(1));
    await act(async () => publishAuth(replacement));
    await act(async () => pending.resolve({ user: { ...UNVERIFIED, emailVerified: true } }));
    // The switch ends the page (issue 1017); no account is shown again.
    expect(screen.getByText('Switching accounts…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
    expect(auth.currentUser).toBe(replacement);
  });

  it('does not exchange an old OTP token after an account switch during the HTTP request', async () => {
    const pendingHttp = deferred();
    vi.mocked(fetch).mockReturnValue(pendingHttp.promise);
    vi.mocked(signInWithCustomToken).mockImplementation(async () => customTokenResult({ ...UNVERIFIED, emailVerified: true }));
    renderAuth();
    verify();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const replacement = { uid: 'other-attendee', emailVerified: false };
    await act(async () => publishAuth(replacement));
    await act(async () => pendingHttp.resolve({ ok: true, status: 200, json: async () => ({ token: 'old-custom-token' }) }));
    await act(async () => {});
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(auth.currentUser).toBe(replacement);
    expect(screen.getByText('Switching accounts…')).toBeInTheDocument();
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

// Issue 1017: the Firestore cache belongs to the tab. A sign-out reloads the
// page; another account in the same document is never published to it.
describe('account change in one tab', () => {
  it('reloads the page after a sign-out and shows the signed-out state until then', async () => {
    renderAuth();
    await act(async () => publishAuth(null));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Account')).toHaveTextContent('signed out');
  });

  it.each([
    ['directly', [{ uid: 'other-attendee', emailVerified: true }]],
    ['after a sign-out', [null, { uid: 'other-attendee', emailVerified: true }]],
  ])('shows only the switching status when another account signs in %s', async (_how, sequence) => {
    renderAuth();
    for (const nextUser of sequence) await act(async () => publishAuth(nextUser));
    expect(screen.getByText('Switching accounts…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
    expect(reloadPage).toHaveBeenCalled();
    // A later auth event, even the first account again, does not reopen the tree.
    await act(async () => publishAuth({ ...UNVERIFIED }));
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
  });

  it('does not reload when the first account signs in or the same account refreshes', async () => {
    auth.currentUser = null;
    renderAuth();
    await act(async () => publishAuth({ uid: 'new-attendee', emailVerified: false }));
    await act(async () => publishAuth({ uid: 'new-attendee', emailVerified: true }));
    expect(reloadPage).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Account')).toHaveTextContent('new-attendee: verified');
  });

  it('keeps the same account after a sign-out and sign-in again in this document', async () => {
    renderAuth();
    await act(async () => publishAuth(null));
    await act(async () => publishAuth({ ...UNVERIFIED }));
    expect(screen.getByLabelText('Account')).toHaveTextContent('existing-attendee: unverified');
  });
});
