// Speaker invite acceptance page (issue #21). The HTTP seam is mocked, so
// these assert the states a speaker can actually land in — and the exact
// request bodies the server contract expects:
//
//   validateSpeakerInvite { token }            → the page's opening branch
//   acceptSpeakerInvite   { token } + Bearer   → the §4.3 acceptance seam
//
// The server answers 200 for an invalid token as well as a valid one (one
// status code for every outcome, no oracle), so the page must branch on
// `valid` — a test that returned 404 for the miss would pass against a
// client that read `response.ok` and fail in production.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

let currentUser = null;
const signOutMock = vi.fn(async () => {});
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next(currentUser);
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: (...args) => signOutMock(...args),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../App.jsx';

const TOKEN = 'a'.repeat(64);

const VALID_INVITE = {
  valid: true,
  speakerId: 'rae-okonkwo',
  speakerName: 'Rae Okonkwo',
  inviteType: 'panelist',
  invitedEmailMasked: 'r**@example.org',
  expiresAt: '2026-09-04T12:00:00.000Z',
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Route the mocked fetch by endpoint name. */
function routeFetch({ validate, accept }) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).endsWith('/validateSpeakerInvite')) return validate;
    if (String(url).endsWith('/acceptSpeakerInvite')) {
      if (typeof accept === 'function') return accept();
      return accept;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderAccept(query = `?token=${TOKEN}`) {
  return render(
    <MemoryRouter
      initialEntries={[`/speaker/accept${query}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

const signedInUser = {
  uid: 'u1',
  email: 'rae@example.org',
  getIdToken: async () => 'id-token',
};

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('checking the link', () => {
  it('sends the token from the URL and shows who the invitation is for', async () => {
    routeFetch({ validate: jsonResponse(200, VALID_INVITE) });
    renderAccept();

    await screen.findByText(/Rae Okonkwo, you are invited/);
    expect(screen.getByText(/panelist/)).toBeInTheDocument();
    // Masked, never the full address (the link may have travelled).
    expect(screen.getAllByText(/r\*\*@example\.org/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/rae@example\.org/)).not.toBeInTheDocument();

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ token: TOKEN });
  });

  it('offers the sign-in form, not an accept button, while signed out', async () => {
    routeFetch({ validate: jsonResponse(200, VALID_INVITE) });
    renderAccept();

    await screen.findByLabelText('Email address');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the invitation' })).not.toBeInTheDocument();
  });

  it('reads `valid: false` as the miss, even though the status is 200', async () => {
    routeFetch({ validate: jsonResponse(200, { valid: false, reason: 'invalid' }) });
    renderAccept();

    await screen.findByText('This invitation link is not valid');
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
  });

  it('distinguishes an expired link, so the speaker asks for a new one', async () => {
    routeFetch({ validate: jsonResponse(200, { valid: false, reason: 'expired' }) });
    renderAccept();

    await screen.findByText('This invitation has expired');
    expect(screen.getByText(/Ask the organizers to send you a new one/)).toBeInTheDocument();
  });

  it('treats a missing token as an invalid link without calling the server', async () => {
    routeFetch({ validate: jsonResponse(200, VALID_INVITE) });
    renderAccept('');

    await screen.findByText('This invitation link is not valid');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('never calls a connection failure an invalid invitation', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderAccept();

    await screen.findByText('We could not check your invitation');
    expect(screen.queryByText('This invitation link is not valid')).not.toBeInTheDocument();
  });
});

describe('accepting', () => {
  beforeEach(() => {
    currentUser = signedInUser;
  });

  it('posts the token with the ID token and confirms the link', async () => {
    routeFetch({
      validate: jsonResponse(200, VALID_INVITE),
      accept: jsonResponse(200, {
        speakerId: 'rae-okonkwo',
        speakerName: 'Rae Okonkwo',
        status: 'accepted',
      }),
    });
    renderAccept();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));

    await screen.findByText('You are confirmed');
    expect(screen.getByRole('link', { name: 'Write your speaker profile' })).toHaveAttribute(
      'href',
      '/speaker/profile',
    );

    const acceptCall = globalThis.fetch.mock.calls.find(([url]) =>
      String(url).endsWith('/acceptSpeakerInvite'),
    );
    expect(JSON.parse(acceptCall[1].body)).toEqual({ token: TOKEN });
    expect(acceptCall[1].headers.Authorization).toBe('Bearer id-token');
  });

  it('turns an address mismatch into the instruction that resolves it', async () => {
    // The server refuses to link an account at any address other than the
    // invited one, so a retry button could never succeed here — the page
    // has to send the speaker to the right inbox instead.
    routeFetch({
      validate: jsonResponse(200, VALID_INVITE),
      accept: jsonResponse(403, {
        error: {
          code: 'email-mismatch',
          message:
            'This invitation was sent to a different email address than the account you are signed in with.',
          invitedEmailMasked: 'r**@example.org',
        },
      }),
    });
    renderAccept();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));

    await screen.findByRole('alert');
    expect(
      await screen.findByRole('button', { name: 'Sign in with the invited address' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/r\*\*@example\.org/).length).toBeGreaterThan(0);
    // No retry affordance that cannot work.
    expect(screen.queryByRole('button', { name: 'Accept the invitation' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with the invited address' }));
    expect(signOutMock).toHaveBeenCalled();
  });

  it('sends a confirmed speaker to the wizard, not the attendee profile', async () => {
    // /speaker/profile edits the canonical speakers/{id} record an
    // organizer approves; /profile is the attendee users/{uid} record
    // (issue #22).
    routeFetch({
      validate: jsonResponse(200, VALID_INVITE),
      accept: jsonResponse(200, { speakerId: 'rae-okonkwo', speakerName: 'Rae Okonkwo', status: 'accepted' }),
    });
    renderAccept();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
    await screen.findByText('You are confirmed');
    expect(screen.queryByRole('link', { name: 'Check your account details' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write your speaker profile' })).toHaveAttribute(
      'href',
      '/speaker/profile',
    );
  });

  it('surfaces link-occupied verbatim and offers the account switch that fixes it', async () => {
    routeFetch({
      validate: jsonResponse(200, VALID_INVITE),
      accept: jsonResponse(409, {
        error: {
          code: 'link-occupied',
          message:
            'The account you are signed in as is already linked to a different speaker record. ' +
            'Sign in with the account you use for this event, or ask the organizers to unlink the other record.',
        },
      }),
    });
    renderAccept();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already linked to a different speaker record/);
    // Still on the accept step: the invitation is untouched, and the way out
    // is signing in as somebody else.
    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(signOutMock).toHaveBeenCalled();
  });

  it('keeps the retry affordance when the account document is not seeded yet', async () => {
    routeFetch({
      validate: jsonResponse(200, VALID_INVITE),
      accept: jsonResponse(409, {
        error: { code: 'account-not-ready', message: 'Your account is still being set up. Wait a moment and try again.' },
      }),
    });
    renderAccept();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Accept the invitation' })).toBeEnabled();
  });

  it('moves the whole page to the expired state when the token dies mid-flight', async () => {
    routeFetch({
      validate: jsonResponse(200, VALID_INVITE),
      accept: jsonResponse(410, {
        error: { code: 'invite-expired', message: 'This invitation has expired. Ask the organizers to send a new one.' },
      }),
    });
    renderAccept();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept the invitation' }));

    await screen.findByText('This invitation has expired');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Accept the invitation' })).not.toBeInTheDocument(),
    );
  });
});
