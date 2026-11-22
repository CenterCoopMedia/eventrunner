// Complete your registration (ADR 0008 §5): one Questions step per ticket
// (or one for the account), then Review. The network seams are mocked; the
// shared answer check runs for real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

let authValue;
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => authValue }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { id: 'ev' } }) }));
vi.mock('../lib/useDocumentTitle.js', () => ({ useDocumentTitle: () => {} }));
vi.mock('../lib/viewport.js', () => ({ useMediaQuery: () => true, WIDE_VIEWPORT: '' }));
vi.mock('../components/SignInPanel.jsx', () => ({ default: () => <div data-testid="sign-in-panel" /> }));

let formListener;
let currentForm;
vi.mock('../lib/registrationFormSource.js', () => ({
  subscribeRegistrationForm: (onNext) => { formListener = onNext; onNext(currentForm); return () => {}; },
}));
let provider;
vi.mock('../lib/useRegistrationLink.js', () => ({ readTicketingCatalog: () => Promise.resolve({ provider }) }));
let tickets;
vi.mock('../lib/ticketingCommerce.js', () => ({ ticketingRequest: () => Promise.resolve({ tickets, nextCursor: null }) }));

const records = {};
const saveMock = vi.fn();
vi.mock('../lib/registrationAnswersApi.js', async (importActual) => ({
  ...(await importActual()),
  readOwnAnswers: ({ ticketId, uid }) => Promise.resolve(records[ticketId || `account-${uid}`] ?? null),
  saveRegistrationAnswers: (...args) => saveMock(...args),
}));

const { default: CompleteRegistration } = await import('./CompleteRegistration.jsx');

const FORM = {
  standard: { organization: { enabled: true, required: true }, photoConsent: { enabled: true, required: false } },
  custom: [],
  revision: 2,
};
const TICKETS = [
  { id: 't1', ticketClass: 'General', firstName: 'Ada', lastName: 'Lovelace', status: 'valid' },
  { id: 't2', ticketClass: 'Student', firstName: 'Bo', lastName: 'Lee', status: 'valid' },
  { id: 't3', ticketClass: 'General', firstName: 'Cy', lastName: 'Ng', status: 'refunded' },
];

function apiError(code, message) {
  return Object.assign(new Error(message), { code });
}

function receipt({ ticketId, answers, formRevision, expectedAnswerRevision }) {
  return { ticketId, answers, formRevision, answerRevision: (expectedAnswerRevision ?? 0) + 1 };
}

function renderAt(path = '/registration') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/registration" element={<CompleteRegistration />} />
        <Route path="/registration/:stepSlug" element={<CompleteRegistration />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authValue = { user: { uid: 'u1', emailVerified: true, getIdToken: async () => 'tok' }, loading: false };
  currentForm = FORM;
  provider = 'stripe';
  tickets = TICKETS;
  for (const key of Object.keys(records)) delete records[key];
  saveMock.mockReset();
  saveMock.mockImplementation(async (request) => receipt(request));
});

describe('CompleteRegistration', () => {
  it('asks a signed-out visitor to sign in on the page', () => {
    authValue = { user: null, loading: false };
    renderAt();
    expect(screen.getByTestId('sign-in-panel')).toBeInTheDocument();
  });

  it('says there is nothing to answer when the form asks no questions', async () => {
    currentForm = null;
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Nothing to answer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
  });

  it('reattaches a stalled question read without treating it as an empty form', async () => {
    currentForm = undefined;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let retry;
    try {
      renderAt();
      expect(screen.getByText('Loading your registration…')).toBeVisible();
      act(() => vi.advanceTimersByTime(60_000));
      retry = screen.getByRole('button', { name: 'Try again' });
      expect(screen.queryByRole('heading', { name: 'Nothing to answer' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'You need a ticket first' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    currentForm = FORM;
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Ticket: General for Ada Lovelace' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('explains a ticket is needed when the account holds none', async () => {
    tickets = [TICKETS[2]];
    renderAt();
    expect(await screen.findByRole('heading', { name: 'You need a ticket first' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /your tickets/i })).toHaveAttribute('href', '/tickets/mine');
  });

  it('retains answers and lets the original save finish after its deadline', async () => {
    let finish;
    saveMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderAt('/registration/answers-1');
    const organization = await screen.findByLabelText('Organization (required)');
    fireEvent.change(organization, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByLabelText('Yes'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      fireEvent.click(screen.getByRole('button', { name: /Next: Ticket: Student/ }));
      expect(screen.getByText('Saving your answers…')).toBeVisible();
      act(() => vi.advanceTimersByTime(15_000));
      expect(screen.getByText(/We don’t know whether your answers were saved/)).toBeVisible();
      expect(organization).toHaveValue('Acme');
      expect(screen.getByLabelText('Yes')).toBeChecked();
      expect(screen.getByRole('button', { name: 'Try saving again' })).toBeVisible();
      const ticketsLink = screen.getByRole('link', { name: 'View your tickets (opens in a new tab)' });
      expect(ticketsLink).toHaveAttribute('target', '_blank');
      expect(ticketsLink).toHaveAttribute('href', '/tickets/mine');
      expect(screen.queryByRole('button', { name: /^Next:/ })).toBeNull();
      fireEvent.submit(organization.closest('form'));
      expect(saveMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
    await act(async () => finish(receipt(saveMock.mock.calls[0][0])));
    expect(screen.getByRole('heading', { name: 'Ticket: Student for Bo Lee' })).toBeVisible();
  });

  it('replays the same pending write and ignores a late reply from the first send', async () => {
    let finishFirst;
    let finishRetry;
    saveMock
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
    renderAt('/registration/answers-1');
    const organization = await screen.findByLabelText('Organization (required)');
    fireEvent.change(organization, { target: { value: 'Acme' } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      fireEvent.click(screen.getByRole('button', { name: /Next: Ticket: Student/ }));
      act(() => vi.advanceTimersByTime(15_000));
      fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }));
      const [original, replay] = saveMock.mock.calls.map(([request]) => request);
      expect(original).toMatchObject({ ticketId: 't1', expectedAnswerRevision: null, requestId: expect.any(String), answers: { organization: 'Acme' } });
      expect(replay).toEqual(original);
      expect(screen.getByText('Saving your answers…')).toBeVisible();
      await act(async () => finishFirst(receipt(original)));
      expect(organization).toHaveValue('Acme');
      expect(screen.getByText('Saving your answers…')).toBeVisible();
      await act(async () => finishRetry(receipt(replay)));
      expect(screen.getByRole('heading', { name: 'Ticket: Student for Bo Lee' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays an account save when the response lacks its receipt', async () => {
    provider = 'none';
    saveMock.mockResolvedValueOnce({});
    renderAt('/registration/answers-1');
    const organization = await screen.findByLabelText('Organization (required)');
    fireEvent.change(organization, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByText(/We don’t know whether your answers were saved/)).toBeVisible();
    expect(organization).toHaveValue('Acme');
    expect(screen.queryByRole('link', { name: 'View your tickets (opens in a new tab)' })).toBeNull();
    fireEvent.submit(organization.closest('form'));
    expect(saveMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }));
    expect(await screen.findByRole('heading', { name: 'Review' })).toBeVisible();
    expect(screen.getByText('Acme')).toBeVisible();
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1]).toEqual(saveMock.mock.calls[0]);
  });

  it('keeps the visitor’s entries when the replay is refused because the saved answers changed', async () => {
    provider = 'none';
    records['account-u1'] = { answers: { organization: 'Earlier entry' }, formRevision: 2, answerRevision: 3 };
    saveMock
      .mockRejectedValueOnce(apiError('network', 'The connection dropped.'))
      .mockRejectedValueOnce(apiError('answers-changed', 'Your saved answers changed. Reload the page to review them before saving again.'));
    renderAt('/registration/answers-1');
    const organization = await screen.findByLabelText('Organization (required)');
    fireEvent.change(organization, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try saving again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your saved answers changed.');
    expect(organization).toHaveValue('Acme');
    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({ expectedAnswerRevision: 3 }));
    expect(saveMock.mock.calls[1]).toEqual(saveMock.mock.calls[0]);
    expect(screen.queryByRole('heading', { name: 'Review' })).toBeNull();
  });

  it('has one step per valid ticket, checks before saving, then saves and moves on', async () => {
    records.t2 = { answers: { organization: 'Bo Co' }, formRevision: 2 };
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Ticket: General for Ada Lovelace' })).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Registration steps' });
    expect(steps).toHaveTextContent('Ticket: Student for Bo Lee');
    expect(steps).toHaveTextContent('Review');
    expect(steps).not.toHaveTextContent('Cy Ng');

    fireEvent.click(screen.getByRole('button', { name: /Next: Ticket: Student/ }));
    expect(await screen.findByText('Answer this question.')).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: ' Acme ' } });
    fireEvent.click(screen.getByLabelText('Yes'));
    fireEvent.click(screen.getByRole('button', { name: /Next: Ticket: Student/ }));
    expect(await screen.findByRole('heading', { name: 'Ticket: Student for Bo Lee' })).toBeInTheDocument();
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 't1', formRevision: 2, answers: { organization: 'Acme', photoConsent: true },
    }));
    // The second ticket is pre-filled from its saved record.
    expect(screen.getByLabelText('Organization (required)')).toHaveValue('Bo Co');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByText('Your answers are saved. You can change them until registration closes.')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('Bo Co')).toBeInTheDocument();
  });

  it('answers once for the account when the event sells no tickets', async () => {
    provider = 'none';
    renderAt('/registration/answers-1');
    expect(await screen.findByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await screen.findByRole('heading', { name: 'Review' });
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ account: true, answers: { organization: 'Acme' } }));
  });

  it('shows the server’s per-question errors on the fields', async () => {
    provider = 'none';
    saveMock.mockRejectedValueOnce(apiError('bad-request', 'answers.organization: Use at most 200 characters.'));
    renderAt();
    fireEvent.change(await screen.findByLabelText('Organization (required)'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByText('Use at most 200 characters.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
  });

  it('reloads changed questions and keeps answers whose question is still asked', async () => {
    provider = 'none';
    saveMock.mockRejectedValueOnce(apiError('form-changed', 'The questions changed.'));
    renderAt();
    fireEvent.change(await screen.findByLabelText('Organization (required)'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByLabelText('No'));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByText(/The questions changed while you were answering/)).toBeInTheDocument();
    act(() => formListener({
      standard: { organization: { enabled: true, required: true }, jobTitle: { enabled: true, required: false } },
      custom: [],
      revision: 3,
    }));
    expect(await screen.findByLabelText('Job title')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization (required)')).toHaveValue('Acme');
    expect(screen.queryByLabelText('No')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await screen.findByRole('heading', { name: 'Review' });
    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({ formRevision: 3, answers: { organization: 'Acme' } }));
  });

  it('keeps reading a saved answer with its own question after the form changes', async () => {
    currentForm = { standard: {}, custom: [{ id: 'q_guest', kind: 'yes_no', label: 'Bringing a guest?', help: '', choices: [], required: true }], revision: 2 };
    saveMock
      .mockImplementationOnce(async (request) => receipt(request))
      .mockRejectedValueOnce(apiError('form-changed', 'The questions changed.'));
    renderAt();
    fireEvent.click(await screen.findByLabelText('Yes'));
    fireEvent.click(screen.getByRole('button', { name: /Next: Ticket: Student/ }));
    await screen.findByRole('heading', { name: 'Ticket: Student for Bo Lee' });
    fireEvent.click(screen.getByLabelText('No'));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByText(/The questions changed while you were answering/)).toBeInTheDocument();
    // The organizer made the same question short text.
    act(() => formListener({ standard: {}, custom: [{ id: 'q_guest', kind: 'short_text', label: 'Guest name', help: '', choices: [], required: false }], revision: 3 }));
    fireEvent.click(screen.getByRole('link', { name: /Review/ }));
    await screen.findByRole('heading', { name: 'Review' });
    // Ticket 1's saved yes still reads as Yes, not as "Not answered".
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('turns read-only once registration has closed', async () => {
    provider = 'none';
    records['account-u1'] = { answers: { organization: 'Acme' }, formRevision: 2 };
    saveMock.mockRejectedValueOnce(apiError('registration-closed', 'Registration is closed.'));
    renderAt();
    await screen.findByLabelText('Organization (required)');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(await screen.findByText(/Registration has closed/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument());
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});
