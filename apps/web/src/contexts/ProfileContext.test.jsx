// ProfileProvider: the account states the UI branches on, and the attendee
// access predicate the directory query is chosen from (issue #17, spec §3.4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const subscriptions = new Map();
const saveOwnProfileMock = vi.fn(() => Promise.resolve());
vi.mock('../lib/profileSource.js', () => ({
  subscribeOwnProfile: (uid, onNext, onConfirmed) => {
    subscriptions.set(uid, { onNext, onConfirmed });
    return () => subscriptions.delete(uid);
  },
  saveOwnProfile: (...args) => saveOwnProfileMock(...args),
}));

let authValue = { user: null, isAdmin: false };
vi.mock('./AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));

const { ProfileProvider, useProfile } = await import('./ProfileContext.jsx');

function Probe() {
  const { status, attendeeAccess, needsProfileSetup, profileConfirmed, profileReady } = useProfile();
  return (
    <ul>
      <li>status:{status}</li>
      <li>access:{String(attendeeAccess)}</li>
      <li>setup:{String(needsProfileSetup)}</li>
      <li>confirmed:{String(profileConfirmed)}</li>
      <li>ready:{String(profileReady)}</li>
    </ul>
  );
}

function renderProvider() {
  return render(
    <ProfileProvider>
      <Probe />
    </ProfileProvider>,
  );
}

/** Push an account document through the captured subscription. */
function pushProfile(uid, profile) {
  act(() => {
    subscriptions.get(uid).onNext(profile);
  });
}

beforeEach(() => {
  subscriptions.clear();
  saveOwnProfileMock.mockClear();
  authValue = { user: null, isAdmin: false };
});

describe('ProfileProvider', () => {
  it('keeps resolved account readiness offline while live confirmation and identity remain separate', () => {
    const profile = { displayName: 'Rae', profileVisibility: 'private', registrationStatus: 'approved' };
    authValue = { user: { uid: 'u1' }, isAdmin: false };
    const { rerender } = renderProvider();
    pushProfile('u1', profile);
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    act(() => subscriptions.get('u1').onConfirmed(true));
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(screen.getByText('confirmed:true')).toBeInTheDocument();
    pushProfile('u1', profile);
    act(() => subscriptions.get('u1').onConfirmed(false));
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    expect(screen.getByText('confirmed:false')).toBeInTheDocument();
    expect(screen.getByText('access:true')).toBeInTheDocument();
    pushProfile('u1', null);
    act(() => subscriptions.get('u1').onConfirmed(true));
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    pushProfile('u1', profile);
    act(() => subscriptions.get('u1').onConfirmed(true));
    const old = subscriptions.get('u1');
    authValue = { user: { uid: 'u2' }, isAdmin: false };
    rerender(<ProfileProvider><Probe /></ProfileProvider>);
    act(() => { old.onNext(profile); old.onConfirmed(true); });
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    expect(screen.getByText('confirmed:false')).toBeInTheDocument();
    expect(screen.getByText('access:false')).toBeInTheDocument();
    pushProfile('u2', profile);
    act(() => subscriptions.get('u2').onConfirmed(false));
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    act(() => subscriptions.get('u2').onConfirmed(true));
    expect(screen.getByText('ready:true')).toBeInTheDocument();
    authValue = { user: null, isAdmin: false };
    rerender(<ProfileProvider><Probe /></ProfileProvider>);
    expect(screen.getByText('ready:false')).toBeInTheDocument();
    expect(screen.getByText('confirmed:false')).toBeInTheDocument();
  });

  it('is signed-out with no subscription when nobody is signed in', () => {
    renderProvider();
    expect(screen.getByText('status:signed-out')).toBeInTheDocument();
    expect(screen.getByText('access:false')).toBeInTheDocument();
    expect(subscriptions.size).toBe(0);
  });

  it('reports pending-account between first sign-in and the auth trigger seeding the doc', () => {
    authValue = { user: { uid: 'u1' }, isAdmin: false };
    renderProvider();
    pushProfile('u1', null);
    expect(screen.getByText('status:pending-account')).toBeInTheDocument();
    expect(screen.getByText('access:false')).toBeInTheDocument();
  });

  it('denies attendee access to a pending account', () => {
    authValue = { user: { uid: 'u1' }, isAdmin: false };
    renderProvider();
    pushProfile('u1', {
      displayName: 'Rae',
      profileVisibility: 'attendees_only',
      registrationStatus: 'pending',
      speakerId: null,
    });
    expect(screen.getByText('status:ready')).toBeInTheDocument();
    expect(screen.getByText('access:false')).toBeInTheDocument();
    expect(screen.getByText('setup:false')).toBeInTheDocument();
  });

  it('grants attendee access to an approved account, a speaker, and an admin', () => {
    for (const [profile, isAdmin] of [
      [{ registrationStatus: 'approved', speakerId: null }, false],
      [{ registrationStatus: 'pending', speakerId: 'spk-1' }, false],
      [{ registrationStatus: 'pending', speakerId: null }, true],
    ]) {
      authValue = { user: { uid: 'u1' }, isAdmin };
      const { unmount } = renderProvider();
      pushProfile('u1', { displayName: 'Rae', profileVisibility: 'public', ...profile });
      expect(screen.getByText('access:true')).toBeInTheDocument();
      unmount();
      subscriptions.clear();
    }
  });

  it('flags a seeded but unfinished profile for setup', () => {
    authValue = { user: { uid: 'u1' }, isAdmin: false };
    renderProvider();
    pushProfile('u1', {
      displayName: '',
      profileVisibility: 'attendees_only',
      registrationStatus: 'pending',
    });
    expect(screen.getByText('setup:true')).toBeInTheDocument();
  });

  it('refuses to save when nobody is signed in', async () => {
    let saveProfile;
    function Saver() {
      ({ saveProfile } = useProfile());
      return null;
    }
    render(
      <ProfileProvider>
        <Saver />
      </ProfileProvider>,
    );
    await expect(saveProfile({ displayName: 'Rae' })).rejects.toThrow(/Sign in/);
    expect(saveOwnProfileMock).not.toHaveBeenCalled();
  });
});
