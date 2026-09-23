// Settings surfaces (issue #14 done-when: "admin settings surfaces round-trip
// config edits"). Each form reads current values from the runtime config
// contexts, posts to its own endpoint, surfaces per-field server validation
// errors, and reflects the saved state when the config listener reports it
// back — no reload, nothing optimistic.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// This file mounts the full settings surfaces — the admin chunk pulls in
// the whole public app for the branding preview, and the config, session,
// and speaker editors each render their own real forms on top of it. On an
// idle machine that first render clears the stock 5s budgets comfortably;
// under a loaded parallel run (#230) it can outrun both vitest's per-test
// timeout and Testing Library's default wait timeout before the gate even
// finishes checking access, failing the file's first test for load, not for
// a defect. Both budgets are widened for this file only — no editor
// behavior changes; a fast run still finishes in well under the new budget.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });
configure({ asyncUtilTimeout: 20_000 });

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
const adminSubscriptions = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    adminSubscriptions.set(name, onNext);
    onNext([]);
    return () => adminSubscriptions.delete(name);
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
// The tier probe (issue #186): the admin_logs read succeeds for an operator
// and is refused for staff; the drafts probe succeeds for both.
let operatorProbeShouldSucceed = true;
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  query: vi.fn((ref) => ref),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn((ref) => (ref?.name === 'admin_logs' && !operatorProbeShouldSucceed
    ? Promise.reject(new Error('permission denied'))
    : Promise.resolve({ docs: [] }))),
}));
afterEach(() => {
  operatorProbeShouldSucceed = true;
});

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
  // Three waits, not one: the lazy admin chunk, the admin probe the gate
  // holds on (AdminGate renders "Checking your access…" until it answers),
  // and the route's own chunk — /admin/settings is deferred too, so the
  // form itself arrives after the area around it. Waiting only for the
  // chunk lets an assertion run while the gate is still checking, which is
  // a flake under load, not a bug.
  //
  // This explicit timeout OVERRIDES the file's configured asyncUtilTimeout
  // (#230) — an explicit `waitFor` timeout always wins over the configured
  // default in Testing Library — so it has to carry the same widened
  // budget itself rather than lean on the file-level config.
  await waitFor(
    () => {
      expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Loading event settings…')).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 20_000 },
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
  adminSubscriptions.clear();
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
    // The whole settings page — three forms, every panel — renders twice
    // here, and this one asserts against all of it. It runs close to the
    // 5s default on a loaded machine, so it states its own budget rather
    // than failing as a flake somebody has to re-run to understand.
  }, 20000);

  it('lets a staff admin save the content and leaves the sender out, shown read-only (issue 186)', async () => {
    operatorProbeShouldSucceed = false;
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);

    // The sender is the operator's: readable, not editable, and said so.
    for (const label of ['Sender email', 'Sender name', 'Reply-to']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('readonly');
    }
    expect(screen.getByLabelText('Sender email')).toHaveValue('summit@example.org');
    expect(screen.getByText(/An operator changes the sender/)).toBeInTheDocument();

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.change(screen.getByLabelText('Event name'), {
      target: { value: 'Community Media Summit 2027' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const payload = bodyOf(0).event;
    expect(payload.name).toBe('Community Media Summit 2027');
    // The whole editable slice minus the one block staff cannot change.
    expect(payload).not.toHaveProperty('sender');
    expect(payload).toHaveProperty('venue');
    expect(payload).toHaveProperty('registration');
    expect(await screen.findByText(/picks the change up live/i)).toBeInTheDocument();
  }, 20000);

  it('lets an operator edit the sender, and sends it', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    expect(screen.getByLabelText('Sender email')).not.toHaveAttribute('readonly');
    expect(screen.queryByText(/An operator changes the sender/)).toBeNull();
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.change(screen.getByLabelText('Sender name'), { target: { value: 'The Summit desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.sender).toEqual({ email: 'summit@example.org', name: 'The Summit desk', replyTo: null });
  }, 20000);

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

  it('edits venue places and one-way movements', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [
          { id: 'main-hall', name: 'Main hall' },
          { id: 'studio', name: 'Studio', floor: '2' },
        ],
        movements: [{ from: 'main-hall', to: 'studio', walkingMinutes: 0 }],
      },
    });
    expect(screen.getByLabelText('Place 1 id')).toHaveValue('main-hall');
    expect(screen.getByLabelText('Movement 1 walking minutes')).toHaveValue(0);

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.change(screen.getByLabelText('Place 2 name'), {
      target: { value: 'Editing studio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const venue = bodyOf(0).event.venue;
    expect(venue.places[1]).toEqual({ id: 'studio', name: 'Editing studio', floor: '2' });
    expect(venue.movements[0].walkingMinutes).toBe(0);
  });

  it('sends the venue map, its alt text, and a marker as numbers', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [{ id: 'main-hall', name: 'Main hall' }],
        movements: [],
        map: { image: 'cms-images/a/plan.png', alt: 'A plan.', markers: [] },
      },
    });
    expect(screen.getByLabelText('Map alt text')).toHaveValue('A plan.');

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    fireEvent.change(screen.getByLabelText('Marker 1 room'), {
      target: { value: 'main-hall' },
    });
    fireEvent.change(screen.getByLabelText('Marker 1 across (%)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Marker 1 down (%)'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // Percentages go over the wire as numbers, which is what the shared
    // validator and the public renderer both expect.
    expect(bodyOf(0).event.venue.map).toEqual({
      image: 'cms-images/a/plan.png',
      alt: 'A plan.',
      markers: [{ placeId: 'main-hall', x: 25, y: 75 }],
    });
  });

  it('refuses a map save at submit without ever disabling the button', async () => {
    // Issue #219: the map's fields do NOT join the set that disables "Save
    // event settings". A save is attempted, refused, and the person is put
    // in front of the field that refused it — from the keyboard, which is
    // the only way some people reach that button at all.
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [{ id: 'main-hall', name: 'Main hall' }],
        movements: [],
        map: { image: 'cms-images/a/plan.png', alt: 'A plan.', markers: [] },
      },
    });

    fireEvent.change(screen.getByLabelText('Map alt text'), { target: { value: '  ' } });
    const save = screen.getByRole('button', { name: 'Save event settings' });
    expect(save).toBeEnabled();
    save.focus();
    fireEvent.click(save);

    const alt = screen.getByLabelText('Map alt text');
    await waitFor(() => expect(document.activeElement).toBe(alt));
    expect(alt).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/alt text saying what the map shows/i)).toBeInTheDocument();
    // Nothing was sent.
    expect(fetch).not.toHaveBeenCalled();

    // A blank coordinate is refused the same way rather than becoming 0.
    fireEvent.change(alt, { target: { value: 'A plan.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add marker' }));
    fireEvent.change(screen.getByLabelText('Marker 1 room'), {
      target: { value: 'main-hall' },
    });
    fireEvent.change(screen.getByLabelText('Marker 1 across (%)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    const across = screen.getByLabelText('Marker 1 across (%)');
    await waitFor(() => expect(across).toHaveAttribute('aria-invalid', 'true'));
    expect(fetch).not.toHaveBeenCalled();

    // Fixed, and the same button now saves.
    fireEvent.change(across, { target: { value: '40' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.venue.map.markers[0]).toEqual({
      placeId: 'main-hall',
      x: 40,
      y: 50,
    });
    // Three save attempts against the whole settings page, so it states its
    // own budget rather than failing as a flake on a busy machine.
  }, 20000);

  it('refuses a blank place name at submit and puts the keyboard on it', async () => {
    // The places and the movements mark their fields as they are typed, and
    // the save control stays live, which is the rule. What was missing is
    // the other half of it: submit sent the invalid payload anyway, so the
    // refusal came back from the server a round trip later instead of from
    // the form.
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [{ id: 'main-hall', name: 'Main hall' }],
        movements: [],
      },
    });

    fireEvent.change(screen.getByLabelText('Place 1 name'), { target: { value: '  ' } });
    const save = screen.getByRole('button', { name: 'Save event settings' });
    expect(save).toBeEnabled();
    save.focus();
    fireEvent.click(save);

    const name = screen.getByLabelText('Place 1 name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a place name.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    // Fixed, and the same control saves.
    fireEvent.change(name, { target: { value: 'Main hall' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.venue.places[0].name).toBe('Main hall');
  });

  it('refuses a stored movement whose endpoint names no place', async () => {
    // A document written before the place was renamed carries a route to a
    // room that no longer exists. Sending it back unchanged makes the server
    // refuse it; the form has to refuse it first and say which end is wrong.
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [
          { id: 'main-hall', name: 'Main hall' },
          { id: 'studio', name: 'Studio' },
        ],
        movements: [{ from: 'annexe', to: 'studio', walkingMinutes: 4 }],
      },
    });

    const save = screen.getByRole('button', { name: 'Save event settings' });
    expect(save).toBeEnabled();
    save.focus();
    fireEvent.click(save);

    const from = screen.getByLabelText('Movement 1 from');
    await waitFor(() => expect(document.activeElement).toBe(from));
    expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Select a defined place.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(from, { target: { value: 'main-hall' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.venue.movements[0].from).toBe('main-hall');
  });

  it('drops the server\u2019s rejection before the map\u2019s own refusal takes focus', async () => {
    // A save the SERVER refused leaves a summary and marks its fields. The
    // next save is refused LOCALLY, by the map, and returns before anything
    // is sent \u2014 so the old rejection has to go with it. It used to survive:
    // the summary went on stating a problem the person had already fixed,
    // and focus, which lands on the first marked field in the form, landed
    // on the corrected one rather than on the map field doing the refusing.
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [{ id: 'main-hall', name: 'Main hall' }],
        movements: [],
        map: { image: 'cms-images/a/plan.png', alt: 'A plan.', markers: [] },
      },
    });

    fetch.mockResolvedValueOnce(errorResponse(400, 'bad-request', 'name: must be a nonempty string'));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Event name')).toHaveAttribute('aria-invalid', 'true');

    // Fix the name the server named, then break the map instead.
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Renamed summit' } });
    fireEvent.change(screen.getByLabelText('Map alt text'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    const alt = screen.getByLabelText('Map alt text');
    await waitFor(() => expect(document.activeElement).toBe(alt));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Event name')).not.toHaveAttribute('aria-invalid');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('blocks removal when a live or draft revision uses a place', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [
          { id: 'main-hall', name: 'Main hall' },
          { id: 'studio', name: 'Studio' },
        ],
        movements: [],
      },
    });
    act(() => {
      adminSubscriptions.get('cmsSchedule')([
        { id: 'keynote', title: 'Opening keynote', placeId: 'main-hall' },
      ]);
      adminSubscriptions.get('cmsSchedule_drafts')([
        { id: 'keynote', title: 'Opening keynote', placeId: 'studio' },
      ]);
    });
    expect(screen.getByRole('button', { name: 'Remove Main hall' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Studio' })).toBeDisabled();
    expect(screen.getAllByText(/Used by Opening keynote/)).toHaveLength(2);
  });

  it('removes dependent unsaved routes and moves focus to a surviving control', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      venue: {
        ...LIVE_EVENT.venue,
        places: [
          { id: 'main-hall', name: 'Main hall' },
          { id: 'studio', name: 'Studio' },
        ],
        movements: [{ from: 'main-hall', to: 'studio', walkingMinutes: 4 }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Main hall' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 unsaved route');
    expect(screen.queryByLabelText('Movement 1 from')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove Studio' })).toHaveFocus(),
    );
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

  // THE REGISTRATION ACTION (M7 issue 8). Two fields drive one control the
  // site draws on the home lead and in the header, so both have to reach
  // the save, and both have to be able to say why the server refused them —
  // the URL field had no error binding at all before this issue.
  it('round-trips the registration action, and clears the label when it is emptied', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      registration: {
        opensAt: null,
        closesAt: null,
        externalUrl: 'https://register.example.org/summit',
        actionLabel: 'Get a ticket',
      },
    });

    expect(screen.getByLabelText('External registration URL')).toHaveValue(
      'https://register.example.org/summit',
    );
    expect(screen.getByLabelText('Register button label')).toHaveValue('Get a ticket');

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.change(screen.getByLabelText('Register button label'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const registration = bodyOf(0).event.registration;
    expect(registration.externalUrl).toBe('https://register.example.org/summit');
    // Emptied means "clear this", which is null — never a stored blank that
    // would draw a control with no words on it.
    expect(registration.actionLabel).toBeNull();
  });

  it('marks the registration fields the server refused, each against its own control', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);

    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'registration.externalUrl: must be null or an https:// URL, got "http://register.example.org"; ' +
          'registration.actionLabel: must be null or a nonempty string',
      ),
    );
    fireEvent.change(screen.getByLabelText('External registration URL'), {
      target: { value: 'http://register.example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('registration.externalUrl: must be null or an https:// URL');
    expect(screen.getByLabelText('External registration URL')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Register button label')).toHaveAttribute('aria-invalid', 'true');
    // A rejected save keeps what the operator typed, so they can correct it
    // rather than retype it.
    expect(screen.getByLabelText('External registration URL')).toHaveValue(
      'http://register.example.org',
    );
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

  // THE SOCIAL ACCOUNTS (#231). The site footer and the email footer both
  // list config/event.social.handles, and this panel is the one place an
  // operator edits it.
  it('adds, edits, and removes social accounts, and sends them with the event', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      social: {
        hashtag: '#EventName',
        handles: [{ platform: 'Mastodon', url: 'https://example.org/@eventname' }],
      },
    });
    expect(screen.getByLabelText('Social hashtag')).toHaveValue('#EventName');
    expect(screen.getByLabelText('Account 1 service')).toHaveValue('Mastodon');
    expect(screen.getByLabelText('Account 1 link')).toHaveValue('https://example.org/@eventname');

    fireEvent.change(screen.getByLabelText('Account 1 handle'), { target: { value: '@eventname' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    fireEvent.change(screen.getByLabelText('Account 2 service'), { target: { value: 'Video' } });
    fireEvent.change(screen.getByLabelText('Account 2 link'), {
      target: { value: 'https://example.org/channel' },
    });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.social).toEqual({
      hashtag: '#EventName',
      handles: [
        { platform: 'Mastodon', handle: '@eventname', url: 'https://example.org/@eventname' },
        { platform: 'Video', url: 'https://example.org/channel' },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove account 1' }));
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1).event.social.handles).toEqual([
      { platform: 'Video', url: 'https://example.org/channel' },
    ]);
  }, 20000);

  it('refuses a malformed social account at submit and puts the keyboard on it', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    // A just-added row says nothing until a save is attempted.
    expect(screen.getByLabelText('Account 1 service')).not.toHaveAttribute('aria-invalid');
    fireEvent.change(screen.getByLabelText('Account 1 link'), {
      target: { value: 'javascript:alert(1)' },
    });
    const save = screen.getByRole('button', { name: 'Save event settings' });
    expect(save).toBeEnabled();
    save.focus();
    fireEvent.click(save);

    // Document order: the service field comes first, so it takes the focus.
    const service = screen.getByLabelText('Account 1 service');
    await waitFor(() => expect(document.activeElement).toBe(service));
    expect(service).toHaveAttribute('aria-invalid', 'true');
    const link = screen.getByLabelText('Account 1 link');
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(link).toHaveAccessibleDescription(/Enter the full link, starting with https:\/\//);
    expect(fetch).not.toHaveBeenCalled();

    // The service is fixed; the link still refuses, and now takes the focus.
    fireEvent.change(service, { target: { value: 'Mastodon' } });
    expect(service).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(document.activeElement).toBe(link));
    expect(fetch).not.toHaveBeenCalled();

    // Fixed, and the same control saves.
    fireEvent.change(link, { target: { value: 'https://example.org/@eventname' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.social.handles).toEqual([
      { platform: 'Mastodon', url: 'https://example.org/@eventname' },
    ]);
  }, 20000);

  // A link with no scheme is one the BROWSER calls invalid for a url field.
  // Without noValidate the browser answered it with its own bubble and fired
  // no submit, so the form's own check never ran and nothing was marked —
  // including other fields that were wrong beside it.
  it('marks a link with no scheme itself, because the browser does not answer first', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    const form = screen.getByRole('button', { name: 'Save event settings' }).closest('form');
    expect(form).toHaveAttribute('novalidate');

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    fireEvent.change(screen.getByLabelText('Account 1 service'), { target: { value: 'Mastodon' } });
    const link = screen.getByLabelText('Account 1 link');
    fireEvent.change(link, { target: { value: 'example.org/@eventname' } });
    // The field keeps its url type for the keyboard it brings up.
    expect(link).toHaveAttribute('type', 'url');
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await waitFor(() => expect(document.activeElement).toBe(link));
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(link).toHaveAccessibleDescription(/Enter the full link/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a malformed email address to the server, and marks the field it refuses', async () => {
    // The email fields have no check of their own in the form. With the
    // browser's check off, the server's refusal is the one that names them.
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, legal: { supportEmail: 'help@example.org' } });
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'not an address' } });
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'legal.supportEmail: must be null or an email address, got "not an address"',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await screen.findByRole('alert');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).event.legal.supportEmail).toBe('not an address');
    expect(screen.getByLabelText('Support email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks the social and legal fields the server refused, each against its own control', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', {
      ...LIVE_EVENT,
      legal: { operatorName: 'Example Trust', supportEmail: 'help@example.org' },
      social: { handles: [{ platform: 'Mastodon', url: 'https://example.org/@eventname' }] },
    });
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'social.handles[0].url: this Mastodon account is already listed; '
          + 'social.hashtag: must be null or one word with no spaces, got "a b"; '
          + 'legal.supportEmail: must be null or an email address, got "x"',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Account 1 link')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Social hashtag')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Support email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Account 1 service')).not.toHaveAttribute('aria-invalid');
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
      customBadgeBlockList: ['Restricted'],
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
    expect(bodyOf(0).badges.customBadgeBlockList).toEqual(['Restricted']);
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

// THE MILESTONES AND THE REGISTRATION GOAL (issue #180): stored on
// config/event, listed on the overview.
describe('milestones and the registration goal', () => {
  const SAVED = [
    { label: 'Proposals close', date: '2026-08-01' },
    { label: 'Programme announced', date: '2026-09-01' },
  ];

  it('adds, edits, and removes milestones, moving focus to a field that still exists', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, milestones: SAVED });
    expect(screen.getByLabelText('Milestone 1 name')).toHaveValue('Proposals close');
    expect(screen.getByLabelText('Milestone 2 date')).toHaveValue('2026-09-01');
    expect(screen.getByText(/Anyone can read these dates and names/)).toBeInTheDocument();

    // Add moves focus into the new row's name field.
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Milestone 3 name')));
    fireEvent.change(screen.getByLabelText('Milestone 3 name'), { target: { value: '  Doors open ' } });
    fireEvent.change(screen.getByLabelText('Milestone 3 date'), { target: { value: '2026-10-15' } });

    // Remove moves focus to the row that takes its place…
    fireEvent.click(screen.getByRole('button', { name: 'Remove milestone 1' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Milestone 1 name')));
    expect(screen.getByLabelText('Milestone 1 name')).toHaveValue('Programme announced');
    // …to the row above when the last row goes…
    fireEvent.click(screen.getByRole('button', { name: 'Remove milestone 2' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Milestone 1 name')));
    expect(screen.queryByLabelText('Milestone 2 name')).toBeNull();

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.milestones).toEqual([{ label: 'Programme announced', date: '2026-09-01' }]);

    // …and to "Add milestone" when none is left. An empty list is sent, and clears.
    fireEvent.click(screen.getByRole('button', { name: 'Remove milestone 1' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add milestone' })));
    expect(screen.getByText('No milestones yet.')).toBeInTheDocument();
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1).event.milestones).toEqual([]);
  }, 20000);

  it('sends a new milestone trimmed, beside the rest of the event', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    expect(screen.getByText('No milestones yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone 1 name'), { target: { value: '  Doors open ' } });
    fireEvent.change(screen.getByLabelText('Milestone 1 date'), { target: { value: '2026-10-15' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const payload = bodyOf(0).event;
    expect(payload.milestones).toEqual([{ label: 'Doors open', date: '2026-10-15' }]);
    expect(payload.name).toBe(LIVE_EVENT.name);
  });

  it('stops adding at twenty milestones and says why, without ever disabling the control', async () => {
    await renderAt('/admin/settings');
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      label: `Milestone ${i + 1}`,
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    }));
    await pushConfig('event', { ...LIVE_EVENT, milestones: twenty });

    const add = screen.getByRole('button', { name: 'Add milestone' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).not.toBeDisabled();
    expect(add).toHaveAccessibleDescription('An event can list 20 milestones. Remove one to add another.');
    add.focus();
    fireEvent.click(add);
    expect(screen.queryByLabelText('Milestone 21 name')).toBeNull();
    expect(document.activeElement).toBe(add);

    // One fewer, and the control works again.
    fireEvent.click(screen.getByRole('button', { name: 'Remove milestone 20' }));
    expect(add).not.toHaveAttribute('aria-disabled');
    fireEvent.click(add);
    expect(screen.getByLabelText('Milestone 20 name')).toHaveValue('');
  }, 20000);

  it('refuses a milestone with no date at submit, marks the field, and puts the keyboard on it', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }));
    // A just-added row says nothing until a save is attempted.
    expect(screen.getByLabelText('Milestone 1 date')).not.toHaveAttribute('aria-invalid');
    fireEvent.change(screen.getByLabelText('Milestone 1 name'), { target: { value: 'Doors open' } });
    const save = screen.getByRole('button', { name: 'Save event settings' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    const date = screen.getByLabelText('Milestone 1 date');
    await waitFor(() => expect(document.activeElement).toBe(date));
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(date).toHaveAccessibleDescription('Enter the date of this milestone.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the milestone field the server refused, by its path', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, milestones: SAVED });
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'milestones[0].date: must match YYYY-MM-DD and name a real calendar date; '
          + 'milestones[1].label: must be at most 80 characters',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    // The rejection takes focus, as every server rejection on this page does,
    // and names the field; the field itself is marked.
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(alert).toHaveTextContent('milestones[0].date: must match YYYY-MM-DD');
    expect(screen.getByLabelText('Milestone 1 date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Milestone 1 date')).toHaveAccessibleDescription(/milestones\[0\]\.date: must match/);
    expect(screen.getByLabelText('Milestone 2 name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Milestone 1 name')).not.toHaveAttribute('aria-invalid');
  });

  it('sends the goal as a number, blank as null, and anything else as typed for the server to name', async () => {
    await renderAt('/admin/settings');
    await pushConfig('event', { ...LIVE_EVENT, registration: { goal: 500 } });
    const goal = screen.getByLabelText('Registration goal');
    expect(goal).toHaveValue('500');
    expect(goal).toHaveAttribute('inputmode', 'numeric');

    fireEvent.change(goal, { target: { value: ' 750 ' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).event.registration.goal).toBe(750);

    fireEvent.change(goal, { target: { value: '' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1).event.registration.goal).toBeNull();

    // Not a number: sent as typed, never as NaN (which JSON would turn into
    // null and so clear the goal), and the server's refusal marks the field.
    fireEvent.change(goal, { target: { value: 'many' } });
    fetch.mockResolvedValueOnce(
      errorResponse(400, 'bad-request', 'registration.goal: must be null or a whole number from 1 to 1000000, got "many"'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2][1].body).toContain('"goal":"many"');
    await screen.findByRole('alert');
    expect(goal).toHaveAttribute('aria-invalid', 'true');
    expect(goal).toHaveValue('many');
  }, 20000);

  it('lets a staff admin save milestones and the goal, with the sender left out', async () => {
    operatorProbeShouldSucceed = false;
    await renderAt('/admin/settings');
    await pushConfig('event', LIVE_EVENT);
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }));
    fireEvent.change(screen.getByLabelText('Milestone 1 name'), { target: { value: 'Doors open' } });
    fireEvent.change(screen.getByLabelText('Milestone 1 date'), { target: { value: '2026-10-15' } });
    fireEvent.change(screen.getByLabelText('Registration goal'), { target: { value: '300' } });
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const payload = bodyOf(0).event;
    expect(payload.milestones).toEqual([{ label: 'Doors open', date: '2026-10-15' }]);
    expect(payload.registration.goal).toBe(300);
    expect(payload).not.toHaveProperty('sender');
    expect(await screen.findByText(/picks the change up live/i)).toBeInTheDocument();
  }, 20000);
});
