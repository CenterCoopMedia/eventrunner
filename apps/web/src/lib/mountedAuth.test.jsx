import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { linkWithPopup, reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';

vi.unmock('../firebase.js');
vi.mock('firebase/app', () => ({ initializeApp: (options, name) => ({ options, name }) }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal(), getFirestore: () => ({}),
}));
vi.mock('firebase/auth', () => ({
  getAuth: (app) => ({ app }),
  onAuthStateChanged: (_auth, next) => { next(null); return () => {}; },
  signInWithPopup: vi.fn(async () => ({})),
  signInWithCustomToken: vi.fn(),
  signOut: vi.fn(),
  linkWithPopup: vi.fn(async () => ({})),
  reauthenticateWithPopup: vi.fn(async () => ({})),
  GoogleAuthProvider: class {
    addScope() {}
    static credentialFromResult() { return { accessToken: 'fixture' }; }
  },
}));

afterEach(() => vi.unstubAllEnvs());

it('uses the event Firebase auth domain for both Google popup flows', async () => {
  const authDomain = 'conference-fixture.firebaseapp.com';
  vi.stubEnv('BASE_URL', '/events/conference/');
  vi.stubEnv('VITE_EVENT_PUBLIC_URL', 'https://events.example.test/events/conference/');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'conference-fixture');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', authDomain);
  const { auth } = await import('../firebase.js');
  const { AuthProvider, useAuth } = await import('../contexts/AuthContext.jsx');
  const { requestCalendarAccess } = await import('./calendarSync.js');

  function GoogleSignIn() {
    const { signInWithGoogle } = useAuth();
    return <button type="button" onClick={signInWithGoogle}>Continue with Google</button>;
  }

  render(<AuthProvider><GoogleSignIn /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(signInWithPopup).toHaveBeenCalledWith(auth, expect.anything()));
  expect(auth.app.options.authDomain).toBe(authDomain);

  const attendee = { uid: 'attendee-fixture', auth, providerData: [] };
  await requestCalendarAccess(attendee);
  expect(linkWithPopup).toHaveBeenCalledWith(attendee, expect.anything());
  const linked = { ...attendee, providerData: [{ providerId: 'google.com' }] };
  await requestCalendarAccess(linked);
  expect(reauthenticateWithPopup).toHaveBeenCalledWith(linked, expect.anything());
});
