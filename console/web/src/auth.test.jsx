import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleAuthProvider, OAuthProvider, isSignInWithEmailLink, onIdTokenChanged,
  sendSignInLinkToEmail, signInWithEmailLink, signInWithPopup, signOut,
} from 'firebase/auth';
import { AuthProvider, EMAIL_KEY, signInErrorMessage, useAuth } from './auth.jsx';

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider() { this.providerId = 'google.com'; }),
  OAuthProvider: vi.fn(function OAuthProvider(id) { this.providerId = id; }),
  isSignInWithEmailLink: vi.fn(() => true),
  onIdTokenChanged: vi.fn(),
  sendSignInLinkToEmail: vi.fn(async () => {}),
  signInWithEmailLink: vi.fn(async () => ({})),
  signInWithPopup: vi.fn(async () => ({})),
  signOut: vi.fn(async () => {}),
}));

let api;
function Probe() {
  api = useAuth();
  return <p>{api.ready ? `ready ${api.user ? api.user.email : 'signed out'}` : 'loading'}</p>;
}

beforeEach(() => {
  onIdTokenChanged.mockImplementation((_auth, callback) => {
    callback({ uid: 'ana', email: 'ana@example.org', emailVerified: true });
    return () => {};
  });
});

describe('AuthProvider', () => {
  it('shares the signed-in user once Firebase reports it', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText('ready ana@example.org')).toBeInTheDocument();
  });

  it('passes on an emailed link confirming the session of the same user', () => {
    let report;
    onIdTokenChanged.mockImplementation((_auth, callback) => {
      report = callback;
      callback({ uid: 'ana', email: 'ana@example.org', emailVerified: false });
      return () => {};
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(api.user.emailVerified).toBe(false);
    act(() => report({ uid: 'ana', email: 'ana@example.org', emailVerified: true }));
    expect(api.user.emailVerified).toBe(true);
  });

  it('signs in with Google and with Microsoft in a popup', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(() => api.signInWithGoogle());
    expect(GoogleAuthProvider).toHaveBeenCalled();
    await act(() => api.signInWithMicrosoft());
    expect(OAuthProvider).toHaveBeenCalledWith('microsoft.com');
    expect(signInWithPopup).toHaveBeenCalledTimes(2);
    expect(signInWithPopup.mock.calls[1][1].providerId).toBe('microsoft.com');
  });

  it('sends an email link back to /signin/finish and remembers the address', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(() => api.sendEmailLink(' Sam@Example.org '));
    expect(sendSignInLinkToEmail).toHaveBeenCalledWith({}, 'sam@example.org', {
      url: `${window.location.origin}/signin/finish`,
      handleCodeInApp: true,
    });
    expect(window.localStorage.getItem(EMAIL_KEY)).toBe('sam@example.org');
  });

  it('finishes an email link sign-in and forgets the address', async () => {
    window.localStorage.setItem(EMAIL_KEY, 'sam@example.org');
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(api.isEmailLink('https://x/signin/finish?oobCode=1')).toBe(true);
    expect(isSignInWithEmailLink).toHaveBeenCalled();
    await act(() => api.finishEmailLink('sam@example.org', 'https://x/signin/finish?oobCode=1'));
    expect(signInWithEmailLink).toHaveBeenCalledWith({}, 'sam@example.org', 'https://x/signin/finish?oobCode=1');
    expect(window.localStorage.getItem(EMAIL_KEY)).toBeNull();
    await act(() => api.signOut());
    expect(signOut).toHaveBeenCalled();
  });
});

describe('signInErrorMessage', () => {
  it('says nothing when the reader closed the popup, and plain words otherwise', () => {
    expect(signInErrorMessage({ code: 'auth/popup-closed-by-user' })).toBe('');
    expect(signInErrorMessage({ code: 'auth/account-exists-with-different-credential' }))
      .toMatch(/another sign-in method/);
    expect(signInErrorMessage({ code: 'auth/invalid-action-code' })).toMatch(/expired or was already used/);
    expect(signInErrorMessage(new Error('x'))).toBe('Sign-in did not work. Try again.');
    for (const code of ['auth/popup-blocked', 'auth/invalid-email', 'auth/network-request-failed']) {
      const text = signInErrorMessage({ code });
      expect(text).not.toMatch(/firebase|project|tenant/i);
    }
  });
});
