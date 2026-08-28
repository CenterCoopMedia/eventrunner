// Settings surfaces (issue #14 done-when: "admin settings surfaces round-trip
// config edits"). Each form reads current values from the runtime config
// contexts, posts to its own endpoint, surfaces per-field server validation
// errors, and reflects the saved state when the config listener reports it
// back — no reload, nothing optimistic.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// EventConfigProvider's one seam to Firestore: capture each config doc's
// callback so a test can push a live doc the way onSnapshot would.
const configSubscriptions = new Map();
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
}));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    onNext([]);
    return () => {};
  },
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next({ uid: 'admin-1', email: 'admin@example.org', getIdToken: async () => 'id-token' });
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';

const LIVE_EVENT = {
  name: 'Community Media Summit',
  shortName: 'CMS26',
  tagline: 'Two days of practical craft.',
  timezone: 'America/New_York',
  days: [
    { id: 'day-1', label: 'Day one', date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
  ],
  venue: { name: 'Riverside Hall', city: 'Springfield' },
  sender: { email: 'summit@example.org', name: 'Summit', domainVerified: true },
};

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}
function bodyOf(callIndex) {
  return JSON.parse(fetch.mock.calls[callIndex][1].body);
}

async function renderAt(path) {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  // Two waits, not one: the lazy admin chunk, and then the admin probe the
  // gate holds on (AdminGate renders "Checking your access…" until it
  // answers). Waiting only for the chunk lets an assertion run while the
  // gate is still checking, which is a flake under load, not a bug.
  await waitFor(
    () => {
      expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 5000 },
  );
  return result;
}

/** Push a runtime config doc through the provider's listener. */
async function pushConfig(docId, data) {
  await waitFor(() => expect(configSubscriptions.has(docId)).toBe(true));
  act(() => configSubscriptions.get(docId)(data));

  if (docId === 'event' && screen.queryByLabelText('Event name')) {
    await waitFor(() => expect(screen.getByLabelText('Event name')).toHaveValue(data.name ?? ''));
    return;
  }
  if (docId === 'features') {
    const visibleFlag = Object.keys(data).find((flag) => screen.queryByLabelText(flag));
    if (visibleFlag) {
      await waitFor(() =>
        data[visibleFlag]
          ? expect(screen.getByLabelText(visibleFlag)).toBeChecked()
          : expect(screen.getByLabelText(visibleFlag)).not.toBeChecked(),
      );
    }
    return;
  }
  if (docId === 'badges' && screen.queryByLabelText('Category 1 label')) {
    await waitFor(() =>
      expect(screen.getByLabelText('Category 1 label')).toHaveValue(
        data.categories?.[0]?.label ?? '',
      ),
    );
  }
}

beforeEach(() => {
  configSubscriptions.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('event settings', () => {
  it('renders the live config and round-trips an edit through updateEventConfig', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);

    // Current values come from the runtime config, not the build snapshot.
    expect(screen.getByLabelText('Event name')).toHaveValue('Community Media Summit');
    expect(screen.getByLabelText('Day 1 date')).toHaveValue('2026-10-15');
    expect(screen.getByLabelText('Venue name')).toHaveValue('Riverside Hall');

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.change(screen.getByLabelText('Event name'), {
      target: { value: 'Community Media Summit 2027' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/updateEventConfig$/);
    const payload = bodyOf(0).event;
    expect(payload.name).toBe('Community Media Summit 2027');
    expect(payload.days).toEqual(LIVE_EVENT.days);
    // Read-only, deploy-mirrored, and verification fields are never sent.
    expect(payload).not.toHaveProperty('slug');
    expect(payload).not.toHaveProperty('providers');
    expect(payload.sender).not.toHaveProperty('domainVerified');

    expect(await screen.findByText(/picks the change up live/i)).toBeInTheDocument();
  });

  // The event's concurrent tracks (design brief §4.6): a letter and a name,
  // set here once, so a session names a line by its letter alone.
  it('edits the track list and sends it with the event', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, tracks: [{ letter: 'A', name: 'Practice' }] });

    expect(screen.getByLabelText('Track 1 letter')).toHaveValue('A');
    expect(screen.getByLabelText('Track 1 name')).toHaveValue('Practice');

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }));
    // A letter is sent as a capital, whatever case it was typed in.
    fireEvent.change(screen.getByLabelText('Track 2 letter'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Track 2 name'), {
      target: { value: 'Sustainability' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.tracks).toEqual([
      { letter: 'A', name: 'Practice' },
      { letter: 'B', name: 'Sustainability' },
    ]);
  });

  it('says plainly that an event with one room needs no tracks', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, tracks: [] });
    expect(screen.getByText('No tracks configured yet.')).toBeInTheDocument();
  });

  it('marks the offending track when the server rejects a letter', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, tracks: [{ letter: 'A', name: 'Practice' }] });
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'tracks[0].letter: must be a single capital letter A-Z, got "AA"',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Track 1 letter')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reflects a saved change from the config listener without a reload', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    // The listener echo of a save landing from another surface updates the
    // rendered config (here: the job mark's short name in the docket).
    await pushConfig('event', { ...LIVE_EVENT, shortName: 'SUMMIT27' });
    expect(screen.getByText('SUMMIT27')).toBeInTheDocument();
  });

  it('shows the sender-domain verification state without offering to edit it', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(screen.queryByLabelText(/domain verified/i)).toBeNull();
  });

  it('surfaces per-field server validation errors verbatim', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);

    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'timezone: must be a valid IANA timezone (got "Mars/Olympus"); sender.email: must be an email address',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('timezone: must be a valid IANA timezone (got "Mars/Olympus")');
    expect(alert).toHaveTextContent('sender.email: must be an email address');
    expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Sender email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses to lose a rejected save: the edited value stays in the form', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    fetch.mockResolvedValueOnce(errorResponse(400, 'bad-request', 'name: must be a nonempty string'));

    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Event name')).toHaveValue('   ');
  });
});

// Every one of these forms seeds itself once and then saves its document
// whole (or as a merge over it). If a form seeds from the BUILD-TIME snapshot
// because a sibling config doc reported first, its next save writes those
// snapshot values over production — so each must key its adoption on its OWN
// document's arrival, never on the aggregate 'live' flag.
describe('per-document adoption', () => {
  it('features: a config/event doc arriving first does not freeze the form on snapshot flags', async () => {
    await renderAt('/admin/features');
    // config/event lands first — the aggregate source is now 'live' while
    // config/features has not been seen at all.
    await pushConfig('event', LIVE_EVENT);
    await pushConfig('features', { schedule: false, speakers: true });

    expect(screen.getByLabelText('schedule')).not.toBeChecked();

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/features' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // The snapshot has schedule: true. Saving it would have silently
    // re-enabled a flag production had turned off.
    expect(bodyOf(0).features.schedule).toBe(false);
  });

  it('event: a config/features doc arriving first does not freeze the form on snapshot values', async () => {
    await renderAt('/admin/settings');
    await pushConfig('features', { schedule: true });
    await pushConfig('event', LIVE_EVENT);
    expect(screen.getByLabelText('Event name')).toHaveValue('Community Media Summit');
  });

  it('badges: a config/event doc arriving first does not freeze the form on an empty set', async () => {
    await renderAt('/admin/badges');
    await pushConfig('event', LIVE_EVENT);
    await pushConfig('badges', {
      categories: [{ id: 'role', label: 'Role', maxPicks: 1, badges: [] }],
    });
    expect(screen.getByLabelText('Category 1 label')).toHaveValue('Role');
  });
});

describe('feature flags', () => {
  it('sends every known flag, because an omitted flag means disabled', async () => {
    await renderAt('/admin/features');
    await pushConfig('features', { schedule: true, speakers: false });

    expect(screen.getByLabelText('schedule')).toBeChecked();
    expect(screen.getByLabelText('speakers')).not.toBeChecked();

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/features' }));
    fireEvent.click(screen.getByLabelText('speakers'));
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/updateFeatures$/);
    const payload = bodyOf(0).features;
    expect(payload.speakers).toBe(true);
    expect(payload.schedule).toBe(true);
    // Flags never touched are still present, explicitly false.
    expect(payload.badges).toBe(false);
    expect(Object.values(payload).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('names the offending flag when the server rejects one', async () => {
    await renderAt('/admin/features');
    await pushConfig('features', { schedule: true });
    fetch.mockResolvedValueOnce(
      errorResponse(400, 'bad-request', 'features.schedule: must be a boolean, got "yes"'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save features' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'features.schedule: must be a boolean, got "yes"',
    );
  });
});

describe('badges', () => {
  it('round-trips the configured badge set through updateBadges', async () => {
    await renderAt('/admin/badges');
    await pushConfig('badges', {
      categories: [
        { id: 'role', label: 'Role', maxPicks: 2, badges: [{ id: 'editor', label: 'Editor' }] },
      ],
    });

    expect(screen.getByLabelText('Category 1 label')).toHaveValue('Role');
    expect(screen.getByLabelText('Badge 1 label — category 1')).toHaveValue('Editor');

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/badges' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add badge to category 1' }));
    fireEvent.change(screen.getByLabelText('Badge 2 id — category 1'), {
      target: { value: 'producer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save badges' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/updateBadges$/);
    expect(bodyOf(0).badges.categories[0].badges.map((b) => b.id)).toEqual([
      'editor',
      'producer',
    ]);
    expect(bodyOf(0).badges.categories[0].maxPicks).toBe(2);
  });

  it('surfaces a duplicate-id rejection against the offending category', async () => {
    await renderAt('/admin/badges');
    await pushConfig('badges', {
      categories: [
        { id: 'role', label: 'Role', maxPicks: 1, badges: [] },
        { id: 'role', label: 'Role again', maxPicks: 1, badges: [] },
      ],
    });
    fetch.mockResolvedValueOnce(
      errorResponse(400, 'bad-request', 'badges.categories[1].id: duplicate category id "role"'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save badges' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Category 2 id')).toHaveAttribute('aria-invalid', 'true');
  });
});
