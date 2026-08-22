// Self-service ticket claim page (issue #33). The HTTP seam is mocked, so
// these assert the states an attendee can actually land in.
//
//   ticketingVerifyOrder { orderNumber } + Bearer → the one endpoint
//
// The server answers the SAME 404 for every failure cause (unknown order,
// wrong event, address mismatch, already claimed —
// functions/src/ticketing/registration.cjs), so the page renders exactly
// ONE generic failure message for all of them; these tests assert that
// collapse rather than trying to distinguish causes the server does not.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

let currentUser = null;
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next(currentUser);
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(async () => {}),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../App.jsx';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function routeFetch(verifyOrder) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).endsWith('/ticketingVerifyOrder')) {
      return typeof verifyOrder === 'function' ? verifyOrder() : verifyOrder;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderClaim() {
  return render(
    <MemoryRouter
      initialEntries={['/ticket/claim']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

const signedInUser = {
  uid: 'u1',
  email: 'ada@example.org',
  getIdToken: async () => 'id-token',
};

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('signed out', () => {
  it('offers a sign-in link instead of the claim form', async () => {
    renderClaim();
    await screen.findByText('Sign in to claim your ticket');
    expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
  });
});

describe('signed in', () => {
  beforeEach(() => {
    currentUser = signedInUser;
  });

  it('refuses an empty order number without calling the server', async () => {
    globalThis.fetch = vi.fn();
    renderClaim();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim ticket' }));
    await screen.findByRole('alert');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('posts the order number with the ID token and confirms a single claimed ticket', async () => {
    routeFetch(jsonResponse(200, { ok: true, claimed: 1, registrationStatus: 'ticketed' }));
    renderClaim();

    fireEvent.change(await screen.findByLabelText('Order number'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim ticket' }));

    await screen.findByText('Ticket claimed');
    expect(screen.getByText('Your ticket is now linked to your account.')).toBeInTheDocument();

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ orderNumber: '1234' });
    expect(options.headers.Authorization).toBe('Bearer id-token');
  });

  it('pluralizes for a multi-ticket order', async () => {
    routeFetch(jsonResponse(200, { ok: true, claimed: 3, registrationStatus: 'ticketed' }));
    renderClaim();

    fireEvent.change(await screen.findByLabelText('Order number'), { target: { value: '5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim ticket' }));

    await screen.findByText('3 tickets on that order are now linked to your account.');
  });

  it('shows one generic message for an unknown order, an address mismatch, and an already-claimed ticket alike', async () => {
    routeFetch(jsonResponse(404, { error: { code: 'not-found', message: 'No ticket matches that order number.' } }));
    renderClaim();

    fireEvent.change(await screen.findByLabelText('Order number'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim ticket' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No ticket matches that order number.');
    // Still on the form: a mistyped order number is recoverable.
    expect(screen.getByRole('button', { name: 'Claim ticket' })).toBeEnabled();
  });

  it('never calls a connection failure a bad order number', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderClaim();

    fireEvent.change(await screen.findByLabelText('Order number'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim ticket' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not reach the server');
    expect(alert).not.toHaveTextContent('No ticket matches');
  });
});
