// SessionCard — the pill row is feature-flag conditional (spec §9), and the
// bookmark pill's click itself is further gated by hasAttendeeAccess (spec
// §3.4). No Firebase, no network (spec §8.1) — bookmarksSource is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import SessionCard from './SessionCard.jsx';

const setSessionBookmarkedMock = vi.fn();
vi.mock('../lib/bookmarksSource.js', () => ({
  setSessionBookmarked: (...args) => setSessionBookmarkedMock(...args),
}));

const fixtureConfig = {
  shortName: '[Fixture] LDC',
  timezone: 'America/Chicago',
  venue: { name: '[Fixture] Hall', city: 'Fixtureville' },
  days: [{ id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }],
};

const fixtureSession = {
  id: 'fx-1',
  dayId: 'fx-day-1',
  startTime: '09:05',
  endTime: '09:45',
  title: '[Fixture] Morning kickoff',
  description: '[Fixture] What the day covers.',
  location: 'Main hall',
  type: 'keynote',
  speakerIds: [],
  visible: true,
};

function renderCard({ features = {}, auth = { user: null, hasAttendeeAccess: false }, bookmarked = false } = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <ul>
            <SessionCard session={fixtureSession} eventConfig={fixtureConfig} features={features} bookmarked={bookmarked} />
          </ul>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setSessionBookmarkedMock.mockReset();
});

describe('SessionCard', () => {
  it('links the title to the session detail route', () => {
    renderCard();
    expect(screen.getByRole('link', { name: fixtureSession.title })).toHaveAttribute(
      'href',
      '/schedule/fx-1',
    );
  });

  it('renders no pill row when every relevant feature flag is off', () => {
    renderCard({ features: {} });
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
    expect(screen.queryByText(/add to calendar/i)).toBeNull();
  });

  describe('bookmark pill (features.sessionBookmarks)', () => {
    it('shows a sign-in prompt for a signed-out visitor', () => {
      renderCard({ features: { sessionBookmarks: true }, auth: { user: null, hasAttendeeAccess: false } });
      expect(screen.getByRole('link', { name: /sign in to bookmark/i })).toHaveAttribute(
        'href',
        '/signin',
      );
    });

    it('shows a disabled pill for a signed-in user without attendee access', () => {
      renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' }, hasAttendeeAccess: false },
      });
      const pill = screen.getByText('Bookmark');
      expect(pill.closest('[aria-disabled="true"]')).not.toBeNull();
    });

    it('an approved attendee can toggle the bookmark, optimistically', async () => {
      setSessionBookmarkedMock.mockResolvedValue({ bookmarked: true, count: 1 });
      renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' }, hasAttendeeAccess: true },
        bookmarked: false,
      });
      const button = screen.getByRole('button', { name: /bookmark/i });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(button);
      // Optimistic: flips before the promise resolves.
      expect(screen.getByRole('button', { name: /bookmarked/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(setSessionBookmarkedMock).toHaveBeenCalledWith({
        user: { uid: 'u1' },
        sessionId: 'fx-1',
        bookmarked: true,
      });
    });

    it('reverts the optimistic toggle when the request fails', async () => {
      setSessionBookmarkedMock.mockRejectedValue(new Error('The bookmark could not be saved.'));
      renderCard({
        features: { sessionBookmarks: true },
        auth: { user: { uid: 'u1' }, hasAttendeeAccess: true },
        bookmarked: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /bookmark/i }));
      expect(await screen.findByRole('button', { name: /^Bookmark$/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('The bookmark could not be saved.');
    });
  });

  describe('calendar pill (features.icsExport)', () => {
    it('renders Google/Outlook links and an .ics download button', () => {
      renderCard({ features: { icsExport: true } });
      expect(screen.getByRole('link', { name: 'Google' })).toHaveAttribute(
        'href',
        expect.stringContaining('calendar.google.com'),
      );
      expect(screen.getByRole('link', { name: 'Outlook' })).toHaveAttribute(
        'href',
        expect.stringContaining('outlook.live.com'),
      );
      expect(screen.getByRole('button', { name: '.ics' })).toBeInTheDocument();
    });

    it('renders nothing for a session whose time cannot be resolved', () => {
      renderCard({
        features: { icsExport: true },
      });
      // sanity check against the unresolved case rendering nothing:
      const unresolved = { ...fixtureSession, dayId: 'no-such-day' };
      const { container } = render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthContext.Provider value={{ user: null, hasAttendeeAccess: false }}>
            <ToastProvider>
              <ul>
                <SessionCard session={unresolved} eventConfig={fixtureConfig} features={{ icsExport: true }} />
              </ul>
            </ToastProvider>
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      expect(container.textContent).not.toContain('Add to calendar');
    });
  });

  it('materials and reactions pills stay hidden (no backend yet — TODO stubs)', () => {
    renderCard({ features: { sessionMaterials: true, sessionReactions: true } });
    expect(screen.queryByText(/material/i)).toBeNull();
  });
});
