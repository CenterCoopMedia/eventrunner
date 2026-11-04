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
  saveMock.mockImplementation(({ ticketId, answers, formRevision }) => Promise.resolve({ ticketId, answers, formRevision }));
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

  it('explains a ticket is needed when the account holds none', async () => {
    tickets = [TICKETS[2]];
    renderAt();
    expect(await screen.findByRole('heading', { name: 'You need a ticket first' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /your tickets/i })).toHaveAttribute('href', '/tickets/mine');
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
      .mockImplementationOnce(({ ticketId, answers, formRevision }) => Promise.resolve({ ticketId, answers, formRevision }))
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
