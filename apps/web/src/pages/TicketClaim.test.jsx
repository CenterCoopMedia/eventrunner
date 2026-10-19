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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { signInWithCustomToken } from 'firebase/auth';

vi.mock('../lib/configSource.js', () => ({ subscribeConfigDoc: (id, onNext) => {
  if (id === 'event') onNext({ historicalDemo: false });
  return () => {};
} }));
vi.mock('../lib/announcementsSource.js', () => ({ subscribeAnnouncements: () => () => {} }));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
let profileAvailable = true;
const profileListeners = new Map();
vi.mock('../lib/profileSource.js', () => ({
  subscribeOwnProfile: (uid, next) => {
    profileListeners.set(uid, next);
    next(profileAvailable ? { id: uid, uid, registrationStatus: 'unregistered' } : null);
    return () => profileListeners.delete(uid);
  },
}));

let currentUser = null;
const authListeners = new Set();
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    authListeners.add(next);
    next(currentUser);
    return () => authListeners.delete(next);
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(async () => {}),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
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

function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="current-route">{location.pathname}{location.search}</output>;
}

function renderClaim(entry = '/ticket/claim') {
  return render(
    <MemoryRouter
      initialEntries={[entry]}
    >
      <App />
      <CurrentRoute />
    </MemoryRouter>,
  );
}

const signedInUser = {
  uid: 'u1',
  email: 'ada@example.org',
  emailVerified: true,
  getIdToken: async () => 'id-token',
};

function setAuthUser(user) {
  currentUser = user;
  for (const next of authListeners) next(user);
}

function claimRequests() {
  return globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith('/ticketingVerifyOrder'));
}

async function submitSignInCode(email = signedInUser.email) {
  fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  fireEvent.change(await screen.findByLabelText('Six-digit code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  profileAvailable = true;
  globalThis.fetch = vi.fn();
  vi.mocked(signInWithCustomToken).mockImplementation(async () => {
    setAuthUser(signedInUser);
    return { user: signedInUser };
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('signed out', () => {
  it('offers the shared sign-in form in place without requesting or claiming the order', async () => {
    renderClaim();
    await screen.findByText('Sign in to claim your ticket');
    expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByLabelText('Email address')).toBeInTheDocument();
    expect(within(main).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves the complete claim link through OTP sign-in and claims only on an explicit verified-account submit', async () => {
    const entry = '/ticket/claim?order=group-order-123&source=confirmation';
    profileAvailable = false;
    globalThis.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/sendOtpCode')) return jsonResponse(200, { challengeId: 'challenge-claim', expiresInMinutes: 10 });
      if (String(url).endsWith('/verifyOtpCode')) return jsonResponse(200, { token: 'verified-custom-token' });
      if (String(url).endsWith('/ticketingVerifyOrder')) return jsonResponse(200, { ok: true, claimed: 1, registrationStatus: 'ticketed' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderClaim(entry);
    await submitSignInCode();

    await screen.findByText(/Setting up your account/);
    expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
    expect(claimRequests()).toHaveLength(0);
    await act(async () => profileListeners.get(signedInUser.uid)({ id: signedInUser.uid, uid: signedInUser.uid }));
    expect(await screen.findByLabelText('Order number')).toHaveValue('group-order-123');
    expect(screen.getByTestId('current-route')).toHaveTextContent(entry);
    expect(screen.getByText(/You are signed in as ada@example.org/)).toBeInTheDocument();
    expect(signInWithCustomToken).toHaveBeenCalledWith({}, 'verified-custom-token');
    expect(claimRequests()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Claim ticket' }));

    await screen.findByRole('heading', { name: 'Ticket claimed' });
    expect(claimRequests()).toHaveLength(1);
    const [, options] = claimRequests()[0];
    expect(JSON.parse(options.body)).toEqual({ orderNumber: 'group-order-123' });
    expect(options.headers.Authorization).toBe('Bearer id-token');
  });

  it('keeps a failed sign-in on the claim link without disclosing or claiming an order', async () => {
    const entry = '/ticket/claim?order=group-order-123';
    globalThis.fetch.mockImplementation(async (url) => String(url).endsWith('/sendOtpCode')
      ? jsonResponse(200, { challengeId: 'challenge-claim', expiresInMinutes: 10 })
      : jsonResponse(403, { error: { code: 'invalid-code', message: 'That code is not valid. Request a new code.' } }));
    renderClaim(entry);
    await submitSignInCode();

    await screen.findByText('That code is not valid. Request a new code.');
    expect(screen.getByTestId('current-route')).toHaveTextContent(entry);
    expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim ticket' })).not.toBeInTheDocument();
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(claimRequests()).toHaveLength(0);
  });

  it('waits for verified authentication without claiming when verification changes', async () => {
    currentUser = { ...signedInUser, emailVerified: false };
    const entry = '/ticket/claim?order=group-order-123';
    renderClaim(entry);

    expect(await screen.findByText(/Verify your email before claiming/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue(signedInUser.email);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await act(async () => setAuthUser(signedInUser));
    expect(await screen.findByLabelText('Order number')).toHaveValue('group-order-123');
    expect(screen.getByTestId('current-route')).toHaveTextContent(entry);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('signed in', () => {
  beforeEach(() => {
    currentUser = signedInUser;
  });

  it('keeps the claim link when the server requires a fresh verified sign-in', async () => {
    const entry = '/ticket/claim?order=group-order-123';
    globalThis.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/sendOtpCode')) return jsonResponse(200, { challengeId: 'challenge-reverify', expiresInMinutes: 10 });
      if (String(url).endsWith('/verifyOtpCode')) return jsonResponse(200, { token: 'fresh-verified-token' });
      if (String(url).endsWith('/ticketingVerifyOrder')) return claimRequests().length === 1
        ? jsonResponse(403, { error: { code: 'forbidden', message: 'Verify your email address before claiming a ticket.' } })
        : jsonResponse(200, { ok: true, claimed: 1, registrationStatus: 'ticketed' });
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderClaim(entry);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim ticket' }));

    expect(await screen.findByText(/Your sign-in could not be verified/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue(signedInUser.email);
    expect(screen.getByTestId('current-route')).toHaveTextContent(entry);
    expect(screen.queryByRole('button', { name: 'Claim ticket' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No ticket matches/)).not.toBeInTheDocument();
    expect(claimRequests()).toHaveLength(1);

    await submitSignInCode();
    expect(await screen.findByLabelText('Order number')).toHaveValue('group-order-123');
    expect(screen.getByTestId('current-route')).toHaveTextContent(entry);
    expect(claimRequests()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Claim ticket' }));
    await screen.findByRole('heading', { name: 'Ticket claimed' });
    expect(claimRequests()).toHaveLength(2);
  });

  it('requires the current account document and offers a bounded recovery that preserves the claim link', async () => {
    profileAvailable = false;
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const entry = '/ticket/claim?order=group-order-123&source=confirmation';
    renderClaim(entry);
    await screen.findByText(/Setting up your account/);
    expect(screen.queryByRole('button', { name: 'Claim ticket' })).not.toBeInTheDocument();

    // The context may still carry the previous account during an auth change.
    await act(async () => profileListeners.get(signedInUser.uid)({ id: 'previous-account' }));
    expect(screen.queryByLabelText('Order number')).not.toBeInTheDocument();
    const waitingDeadline = timeout.mock.calls.find(([, delay]) => delay === 15_000)?.[0];
    expect(waitingDeadline).toBeTypeOf('function');
    act(() => waitingDeadline());
    expect(screen.getByRole('alert')).toHaveTextContent('Your account is taking longer to load.');
    expect(screen.getByRole('link', { name: 'Reload claim page' })).toHaveAttribute('href', entry);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    timeout.mockRestore();

    // The existing subscription can recover after that deadline, still without
    // automatically submitting the preserved reference.
    await act(async () => profileListeners.get(signedInUser.uid)({ id: signedInUser.uid }));
    expect(await screen.findByLabelText('Order number')).toHaveValue('group-order-123');
    expect(screen.queryByText(/Your account is taking longer/)).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not start a claim after its account signs out while the ID token is being obtained', async () => {
    let resolveToken;
    const getIdToken = vi.fn(() => new Promise((resolve) => { resolveToken = resolve; }));
    currentUser = { ...signedInUser, getIdToken };
    renderClaim('/ticket/claim?order=group-order-123');
    fireEvent.click(await screen.findByRole('button', { name: 'Claim ticket' }));
    await waitFor(() => expect(getIdToken).toHaveBeenCalledOnce());

    await act(async () => setAuthUser(null));
    await act(async () => resolveToken('old-account-token'));
    expect(await screen.findByText('Sign in to claim your ticket')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not show a previous account’s late claim result after the signed-in account changes', async () => {
    let resolveClaim;
    routeFetch(() => new Promise((resolve) => { resolveClaim = resolve; }));
    renderClaim('/ticket/claim?order=group-order-123');
    fireEvent.click(await screen.findByRole('button', { name: 'Claim ticket' }));
    await waitFor(() => expect(claimRequests()).toHaveLength(1));

    await act(async () => setAuthUser({ ...signedInUser, uid: 'u2', email: 'other@example.org' }));
    await act(async () => resolveClaim(jsonResponse(200, { ok: true, claimed: 3, registrationStatus: 'ticketed' })));
    expect(screen.queryByRole('heading', { name: 'Ticket claimed' })).not.toBeInTheDocument();
    expect(screen.getByText(/You are signed in as other@example.org/)).toBeInTheDocument();
    expect(screen.getByLabelText('Order number')).toHaveValue('group-order-123');
    expect(claimRequests()).toHaveLength(1);
  });

  it('refuses an empty order number without calling the server', async () => {
    globalThis.fetch = vi.fn();
    renderClaim();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim ticket' }));
    await screen.findByRole('alert');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('draws the order number field border on the accessible control token', async () => {
    // WCAG 1.4.11: a form control's boundary needs 3:1 against its ground,
    // and --rule-hairline is deliberately below that bar (design brief
    // §3.7).
    renderClaim();
    const field = await screen.findByLabelText('Order number');
    expect(field).toHaveClass('border-control');
    expect(field).not.toHaveClass('border-rule-hairline');
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
