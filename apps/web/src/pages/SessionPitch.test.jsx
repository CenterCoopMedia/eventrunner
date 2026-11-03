// The /pitch page: the five-step pitch stepper (ADR 0008 §2), and the
// external-form mode that replaces it for a whole call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

// `undefined` keeps the subscription waiting for its first snapshot.
let pitchCall;
let user;
let listener;
const call = vi.fn();
vi.mock('../lib/pitchSource.js', () => ({
  subscribePitchCall: (onNext, onError) => {
    listener = { onNext, onError };
    if (pitchCall !== undefined) onNext(pitchCall);
    return () => {};
  },
}));
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user, loading: false, signOut: vi.fn() }),
}));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { shortName: 'Example Summit' } }),
}));
vi.mock('../admin/adminApi.js', () => ({ useAdminApi: () => call }));
vi.mock('../components/SignInPanel.jsx', () => ({
  default: () => <p>Sign-in panel</p>,
  FormError: ({ message }) => (message ? <p role="alert">{message}</p> : null),
}));

import SessionPitch from './SessionPitch.jsx';
import { DRAFT_KEY } from '../lib/pitchDraft.js';

const FORM = 'https://airtable.com/appExample/shrExample';
const OPEN_UNTIL = '2999-01-31T23:59:59Z';
const NATIVE = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl: null };
const WITH_LISTS = {
  ...NATIVE,
  formOptions: { formats: ['Panel', 'Workshop'], lengths: [30, 60], tracks: ['Audience'], maxCoPresenters: 2 },
};
const SIGNED_IN = { email: 'ada@example.org', emailVerified: true, displayName: 'Ada Reporter' };

let location;
function Where() {
  location = useLocation();
  return null;
}

function renderPitch(path = '/pitch') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pitch" element={<><SessionPitch /><Where /></>} />
        <Route path="/pitch/:stepSlug" element={<><SessionPitch /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const stepHeading = () => document.getElementById('pitch-step-heading');
const next = () => fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  user = null;
  location = null;
  call.mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

describe('SessionPitch with an external form', () => {
  it('links to the external form while the call is open and hides the stepper', () => {
    pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl: FORM };
    renderPitch();
    expect(screen.getByRole('status')).toHaveTextContent('Submissions are open');
    const link = screen.getByRole('link', { name: /Open the pitch form/ });
    expect(link).toHaveAttribute('href', FORM);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(screen.queryByLabelText(/Session title/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Pitch steps' })).toBeNull();
    expect(screen.queryByText(/verified email address is required/)).toBeNull();
  });

  it('shows no link once the call is closed', () => {
    for (const value of [
      { enabled: false, closesAt: OPEN_UNTIL, externalFormUrl: FORM },
      { enabled: true, closesAt: '2000-01-01T00:00:00Z', externalFormUrl: FORM },
    ]) {
      pitchCall = value;
      renderPitch();
      expect(screen.getByRole('status')).toHaveTextContent('Submissions are closed');
      expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
      expect(screen.getByText('The pitch form is not available now.')).toBeInTheDocument();
      cleanup();
    }
  });

  it('never links to an address the server would refuse', () => {
    for (const externalFormUrl of ['http://airtable.com/shr', 'javascript:alert(1)']) {
      pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl };
      renderPitch();
      expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
      expect(screen.getByLabelText(/Session title/)).toBeInTheDocument();
      cleanup();
    }
  });

  it('keeps the external form mode through a read error', () => {
    pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl: FORM };
    renderPitch();
    act(() => listener.onError(new Error('offline')));
    expect(screen.getByRole('status')).toHaveTextContent('Cannot check submissions. Reconnecting…');
    expect(screen.queryByLabelText(/Session title/)).toBeNull();
    expect(screen.getByText('The pitch form is not available now.')).toBeInTheDocument();
  });
});

describe('SessionPitch before the call is known', () => {
  it('shows neither the stepper nor a link while the first snapshot loads', () => {
    pitchCall = undefined;
    renderPitch();
    expect(screen.getByRole('status')).toHaveTextContent('Checking submissions…');
    expect(screen.queryByLabelText(/Session title/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
  });
});

describe('the pitch stepper', () => {
  it('opens on the first step, with every step listed and the later ones not started', () => {
    pitchCall = NATIVE;
    renderPitch();
    expect(stepHeading()).toHaveTextContent('Your session');
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Pitch steps' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '1Your sessionTo do', '2FormatNot started', '3PresentersNot started', '4Access and notesNot started', '5Review and submitNot started',
    ]);
    // Sign-in waits for the Review step.
    expect(screen.queryByText('Sign-in panel')).toBeNull();
  });

  it('checks only the open step on Next, stays on it, and names each problem', async () => {
    pitchCall = NATIVE;
    renderPitch('/pitch/session');
    next();
    expect(await screen.findByText('Enter a session title.')).toBeInTheDocument();
    expect(screen.getByText('Describe your session idea.')).toBeInTheDocument();
    expect(location.pathname).toBe('/pitch/session');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Session title/)));
    expect(call).not.toHaveBeenCalled();
  });

  it('walks every step, shows the answers on Review with Edit links, and submits one body', async () => {
    pitchCall = WITH_LISTS;
    user = SIGNED_IN;
    call.mockResolvedValue({ id: 'pitch-1', ok: true });
    renderPitch();

    type(/Session title/, 'Local news in the library');
    type(/One-line summary/, 'Libraries host newsrooms.');
    type(/Session description/, 'A full description.');
    next();
    await waitFor(() => expect(location.pathname).toBe('/pitch/format'));
    expect(stepHeading()).toHaveTextContent('Format');
    fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), { target: { value: 'Workshop' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Length' }), { target: { value: '60' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Track' }), { target: { value: 'Audience' } });
    type(/Who is it for/, 'beginner');
    next();

    await waitFor(() => expect(location.pathname).toBe('/pitch/presenters'));
    // The lead presenter's name starts from the account.
    expect(screen.getByLabelText(/Your name/)).toHaveValue('Ada Reporter');
    expect(screen.getByText(/ada@example.org, the address you signed in with/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add a co-presenter/ }));
    type(/Co-presenter 1 name/, 'Bo Writer');
    type(/Co-presenter 1 email/, 'bo@example.org');
    next();

    await waitFor(() => expect(location.pathname).toBe('/pitch/access'));
    type(/Access needs/, 'Step-free stage.');
    next();

    await waitFor(() => expect(location.pathname).toBe('/pitch/review'));
    expect(screen.getByText('Submitting as ada@example.org')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit your session' })).toHaveAttribute('href', '/pitch/session');
    expect(screen.getByText('Bo Writer · bo@example.org')).toBeInTheDocument();
    expect(screen.getByText('60 minutes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit pitch' }));
    expect(await screen.findByText('Agree to organizer review before submitting.')).toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit pitch' }));
    expect(await screen.findByRole('heading', { name: 'Your pitch is saved' })).toBeInTheDocument();
    expect(call).toHaveBeenCalledOnce();
    const [name, body] = call.mock.calls[0];
    expect(name).toBe('submitSessionPitch');
    expect(body).toMatchObject({
      title: 'Local news in the library',
      summary: 'Libraries host newsrooms.',
      format: 'Workshop',
      lengthMinutes: 60,
      track: 'Audience',
      audienceLevel: 'beginner',
      leadName: 'Ada Reporter',
      presenters: [{ name: 'Bo Writer', email: 'bo@example.org', organization: null, role: null }],
      accessNeeds: 'Step-free stage.',
      notes: null,
      consent: true,
    });
    expect(body.submissionKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('sends an address of a step that cannot open yet to the first step that needs work', async () => {
    pitchCall = NATIVE;
    renderPitch('/pitch/review');
    await waitFor(() => expect(location.pathname).toBe('/pitch/session'));
    cleanup();
    // An unknown address goes to /pitch, which opens on the first step.
    renderPitch('/pitch/no-such-step');
    await waitFor(() => expect(location.pathname).toBe('/pitch'));
    expect(stepHeading()).toHaveTextContent('Your session');
  });

  it('shows the staff lists as choices, and a free-text format with no list', () => {
    pitchCall = WITH_LISTS;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'T', description: 'D' }));
    renderPitch('/pitch/format');
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Track' })).toBeInTheDocument();
    cleanup();
    pitchCall = NATIVE;
    renderPitch('/pitch/format');
    expect(screen.getByRole('textbox', { name: /Format \(optional\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Track' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Length' })).toBeNull();
  });

  it('hides co-presenters when the call takes one presenter per pitch', () => {
    pitchCall = { ...WITH_LISTS, formOptions: { ...WITH_LISTS.formOptions, maxCoPresenters: 0 } };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'T', description: 'D' }));
    renderPitch('/pitch/presenters');
    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a co-presenter/ })).toBeNull();
  });

  it('asks for sign-in on the Review step, and carries a one-page draft into the stepper', () => {
    pitchCall = NATIVE;
    sessionStorage.setItem('session-pitch-draft-v1', JSON.stringify({
      title: 'Old title', description: 'Old description', organization: '', format: 'Panel', submissionKey: 'legacy-key-0001',
    }));
    renderPitch('/pitch/session');
    expect(screen.getByLabelText(/Session title/)).toHaveValue('Old title');
    expect(sessionStorage.getItem('session-pitch-draft-v1')).toBeNull();
    cleanup();
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'T', description: 'D', leadName: 'Ada' }));
    renderPitch('/pitch/review');
    expect(screen.getByText('Sign-in panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit pitch' })).toBeNull();
  });

  it('keeps the answers and says so when the server refuses the pitch', async () => {
    pitchCall = NATIVE;
    user = SIGNED_IN;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'T', description: 'D', leadName: 'Ada', consent: true }));
    call.mockRejectedValue(Object.assign(new Error('Too many session pitches. Try again later.'), { code: 'rate-limited' }));
    renderPitch('/pitch/review');
    fireEvent.click(screen.getByRole('button', { name: 'Submit pitch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many session pitches. Try again later. Your entries are still here.');
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)).title).toBe('T');
  });
});

describe('SessionPitch with no deadline', () => {
  it('takes pitches with no deadline and shows no deadline or countdown', () => {
    pitchCall = { enabled: true, closesAt: null, externalFormUrl: null };
    const { container } = renderPitch();
    expect(screen.getByText('Submissions are open')).toBeInTheDocument();
    expect(screen.getByText('There is no set deadline. The organizers close submissions when they are ready.')).toBeInTheDocument();
    expect(screen.queryByText(/Deadline:/)).toBeNull();
    expect(container.querySelector('time')).toBeNull();
  });

  it('reads as closed after staff close the call by hand, and Submit is unavailable', () => {
    pitchCall = { enabled: true, closesAt: null, externalFormUrl: null };
    user = SIGNED_IN;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'T', description: 'D', leadName: 'Ada' }));
    renderPitch('/pitch/review');
    act(() => listener.onNext({ enabled: false, closesAt: null, externalFormUrl: null }));
    expect(screen.getByText('Submissions are closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit pitch' })).toBeDisabled();
  });

  it('treats an open call with no closesAt field as closed', () => {
    pitchCall = { enabled: true, externalFormUrl: null };
    renderPitch();
    expect(screen.getByText('Submissions are closed')).toBeInTheDocument();
  });
});
