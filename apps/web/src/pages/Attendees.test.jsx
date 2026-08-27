// Attendee directory: the feature gate, the two query shapes, and the
// fail-soft states (issue #17, spec §3.4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let features;
let badgesConfig;
let profileValue;
const subscribeDirectoryMock = vi.fn();

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features, badges: badgesConfig }),
}));
vi.mock('../contexts/ProfileContext.jsx', () => ({
  useProfile: () => profileValue,
}));
vi.mock('../lib/profileSource.js', () => ({
  subscribeDirectory: (...args) => subscribeDirectoryMock(...args),
}));

const { default: Attendees } = await import('./Attendees.jsx');

function renderPage() {
  return render(
    <MemoryRouter>
      <Attendees />
    </MemoryRouter>,
  );
}

/** Push a directory result through the captured subscription. */
function pushProfiles(profiles) {
  const [, onNext] = subscribeDirectoryMock.mock.calls.at(-1);
  act(() => onNext(profiles));
}

beforeEach(() => {
  features = { attendeeDirectory: true, publicAttendeeProfiles: false, badges: false };
  badgesConfig = null;
  profileValue = { status: 'ready', attendeeAccess: true, profile: null, needsProfileSetup: false };
  subscribeDirectoryMock.mockReset();
  subscribeDirectoryMock.mockReturnValue(() => {});
});

describe('Attendees', () => {
  it('gates the route behind config/features.attendeeDirectory, not just the nav link', () => {
    features.attendeeDirectory = false;
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have an attendee directory' }),
    ).toBeInTheDocument();
    expect(subscribeDirectoryMock).not.toHaveBeenCalled();
  });

  it('asks a signed-out visitor’s browser for public profiles only', () => {
    features.publicAttendeeProfiles = true;
    profileValue = { status: 'signed-out', attendeeAccess: false, profile: null, needsProfileSetup: false };
    renderPage();
    expect(subscribeDirectoryMock.mock.calls[0][0]).toEqual({ includeAttendeesOnly: false });
  });

  it('sends a signed-out visitor to sign-in when the event has no public profiles', () => {
    profileValue = { status: 'signed-out', attendeeAccess: false, profile: null, needsProfileSetup: false };
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Sign in to see who’s attending' }),
    ).toBeInTheDocument();
    expect(subscribeDirectoryMock).not.toHaveBeenCalled();
  });

  it('asks for the full directory once the viewer has attendee access', () => {
    renderPage();
    expect(subscribeDirectoryMock.mock.calls[0][0]).toEqual({ includeAttendeesOnly: true });
  });

  it('tells a pending attendee what they are seeing and why', () => {
    profileValue = { status: 'ready', attendeeAccess: false, profile: null, needsProfileSetup: false };
    renderPage();
    expect(screen.getByText(/full directory opens up once your registration is approved/i))
      .toBeInTheDocument();
  });

  it('renders each card’s photo, and a lettered avatar for a profile without one', () => {
    renderPage();
    pushProfiles([
      { id: 'u1', displayName: 'Amara Diallo', photoPath: 'profile-photos/u1/photo.png' },
      { id: 'u2', displayName: 'Zeke Alvarez' },
    ]);
    const directory = within(screen.getByRole('article'));
    expect(directory.getByText('Z')).toBeInTheDocument();
    const images = screen.getByRole('article').querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toContain(
      encodeURIComponent('profile-photos/u1/photo.png'),
    );
  });

  it('renders profile cards linked to the individual profile page, sorted by name', () => {
    renderPage();
    pushProfiles([
      { id: 'u2', displayName: 'Zeke Alvarez', jobTitle: 'Editor', organization: 'The Weekly' },
      { id: 'u1', displayName: 'Amara Diallo', speakerId: 'spk-1' },
      // No display name yet: an unfinished profile is not a directory card.
      { id: 'u3', displayName: '' },
    ]);
    // Scope to the directory itself: ProfileSidebar renders its own links.
    const links = within(screen.getByRole('article')).getAllByRole('link');
    const names = links.map((link) => link.textContent);
    expect(names).toEqual(['Amara Diallo', 'Zeke Alvarez']);
    expect(screen.getByRole('link', { name: 'Amara Diallo' })).toHaveAttribute(
      'href',
      '/attendees/u1',
    );
    expect(screen.getByText('Speaker')).toBeInTheDocument();
    expect(screen.getByText('Editor · The Weekly')).toBeInTheDocument();
  });

  it('shows a loading state until a snapshot arrives, and the empty state only for a real empty result', () => {
    renderPage();
    // No snapshot yet: "nobody signed up" would be a lie at this point.
    expect(screen.getByRole('status', { name: 'Loading the attendee directory…' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No attendee profiles yet' })).toBeNull();

    pushProfiles([]);
    expect(screen.getByRole('heading', { name: 'No attendee profiles yet' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading the attendee directory…' })).toBeNull();
  });

  it('renders a profile whose fields are the wrong type instead of crashing the directory', () => {
    renderPage();
    pushProfiles([
      { id: 'u1', displayName: 'Amara Diallo', pronouns: { a: 1 }, jobTitle: ['Editor'] },
    ]);
    expect(screen.getByRole('link', { name: 'Amara Diallo' })).toBeInTheDocument();
  });

  it('renders badge labels resolved from live config, dropping ids no longer configured', () => {
    features.badges = true;
    badgesConfig = {
      categories: [{ id: 'craft', label: 'Craft', maxPicks: 2, badges: [{ id: 'writer', label: 'Writer' }] }],
    };
    renderPage();
    pushProfiles([
      { id: 'u1', displayName: 'Amara Diallo', badges: ['writer', 'left-over-id'] },
    ]);
    expect(screen.getByText('Writer')).toBeInTheDocument();
    expect(screen.queryByText('left-over-id')).toBeNull();
  });

  it('renders no badges section when config/features.badges is off', () => {
    features.badges = false;
    badgesConfig = {
      categories: [{ id: 'craft', label: 'Craft', maxPicks: 2, badges: [{ id: 'writer', label: 'Writer' }] }],
    };
    renderPage();
    pushProfiles([{ id: 'u1', displayName: 'Amara Diallo', badges: ['writer'] }]);
    expect(screen.queryByText('Writer')).toBeNull();
  });

  it('says the directory is unavailable when the listener fails, rather than showing it empty', () => {
    renderPage();
    const [, , onFail] = subscribeDirectoryMock.mock.calls[0];
    act(() => onFail(new Error('permission denied')));
    expect(
      screen.getByRole('heading', { name: 'The directory is unavailable right now' }),
    ).toBeInTheDocument();
  });
});
