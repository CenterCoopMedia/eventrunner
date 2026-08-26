// /speaker/accept in the static demo build (lib/demoMode.js).
//
// Every other demo route is inert because Firestore is offline, but this one
// is reached from an emailed link and validates that link over HTTP the
// moment it mounts. The demo smoke test walks routes with no query string,
// so a `?token=…` deep link was the one way a "backend-free" build could
// still put a visitor's token on the wire. This pins the page to answering
// from a static state instead.
//
// The sibling file SpeakerAccept.test.jsx covers the real (non-demo) page;
// the demo branch needs its own file because IS_DEMO is a module constant.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/demoMode.js', () => ({ IS_DEMO: true, default: true }));

vi.mock('../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

import App from '../App.jsx';

const TOKEN = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  // Anything reaching this is a failure, so make it loud rather than a
  // silently-resolving stub.
  globalThis.fetch = vi.fn(async (url) => {
    throw new Error(`demo build attempted a request: ${url}`);
  });
});

function renderAccept(query) {
  return render(
    <MemoryRouter
      initialEntries={[`/speaker/accept${query}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

describe('/speaker/accept in demo mode', () => {
  it('makes no request for a token-carrying deep link', async () => {
    renderAccept(`?token=${TOKEN}`);

    await screen.findByText('Invitations are disabled in this demo');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('says the feature is disabled rather than that the link is bad', async () => {
    // Nothing about the visitor's link was checked, so "not valid" and
    // "expired" would both be claims the demo is in no position to make.
    renderAccept(`?token=${TOKEN}`);

    await screen.findByText('Invitations are disabled in this demo');
    expect(screen.queryByText('This invitation link is not valid')).not.toBeInTheDocument();
    expect(screen.queryByText('We could not check your invitation')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the event' })).toBeInTheDocument();
  });

  it('shows the same state with no token at all', async () => {
    renderAccept('');

    await screen.findByText('Invitations are disabled in this demo');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
