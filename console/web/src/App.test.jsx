import { hostName } from './text.js';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from './api.js';
import { AuthContext, RETURN_KEY } from './auth.jsx';
import { fakeAuth, signedInUser } from './test/renderPage.jsx';
import { AppRoutes } from './App.jsx';
import { application, serveApi, team } from './test/application.js';
import { keepAnswer, readKeptAnswer } from './setup/keptAnswers.js';

vi.mock('./api.js', () => ({ callApi: vi.fn(async () => ({ operator: false, organizations: [{ id: 'o1', name: 'Org', role: 'owner' }] })) }));

beforeEach(() => {
  callApi.mockImplementation(async () => ({ operator: false, organizations: [{ id: 'o1', name: 'Org', role: 'owner' }] }));
});

const teamImport = vi.hoisted(() => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  return { pending, finish };
});
vi.mock('./pages/Team.jsx', () => teamImport.pending);
vi.mock('./pages/AcceptedAgreement.jsx', () => { throw new Error('synthetic route unavailable'); });

function renderApp(path, auth = fakeAuth()) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return auth;
}

describe('AppRoutes', () => {
  it.each(['popup', 'email in another tab'])('recovers a 401 and offers the original tab’s answer after %s sign-in', async (method) => {
    let setSession;
    let unauthorized = true;
    const auth = fakeAuth({
      signOut: vi.fn(async () => setSession(null)),
      signInWithGoogle: vi.fn(async () => { unauthorized = false; setSession(signedInUser()); }),
    });
    function Session() {
      const [user, update] = useState(signedInUser());
      setSession = update;
      return <AuthContext.Provider value={{ ...auth, user }}><MemoryRouter initialEntries={['/organizations/o1/applications/a1/organization?from=review']}><AppRoutes /></MemoryRouter></AuthContext.Provider>;
    }
    serveApi({ saveApplicationStep: (body) => {
      if (unauthorized) throw Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'unauthorized' });
      return { step: body.step, saved: true, errors: {} };
    } });
    render(<Session />);
    fireEvent.change(await screen.findByLabelText('Organization name'), { target: { value: 'Kept through sign-in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }));
    const recover = await screen.findByRole('button', { name: 'Sign in again' });
    expect(screen.queryByRole('button', { name: 'Save again' })).not.toBeInTheDocument();
    fireEvent.click(recover);
    await screen.findByRole('heading', { name: 'Sign in to Event Runner' });
    expect(await screen.findByText(/If the email link opens another tab, return to this tab/)).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(callApi.mock.calls.filter(([name]) => name === 'saveApplicationStep')).toHaveLength(1);
    if (method === 'popup') fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    else {
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ana@example.org' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
      await waitFor(() => expect(auth.sendEmailLink).toHaveBeenCalledWith('ana@example.org'));
      // Another tab completes the emailed link and clears the shared path.
      // The AuthProvider's existing cross-tab token notification updates us.
      window.localStorage.removeItem(RETURN_KEY);
      unauthorized = false;
      act(() => setSession(signedInUser()));
    }
    const use = await screen.findByRole('button', { name: 'Use kept answer' });
    expect(screen.getByRole('button', { name: 'Back to Review' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveValue('NC Local');
    fireEvent.click(use);
    expect(screen.getByLabelText('Organization name')).toHaveValue('Kept through sign-in');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(readKeptAnswer({ userId: 'ana', orgId: 'o1', appId: 'a1' }, 'organization')).toBeNull();
  });

  it('keeps a decorative Badger inside the semantic page title and main region', () => {
    renderApp('/nowhere');
    const heading = screen.getByRole('heading', { level: 1, name: 'Page not found' });
    expect(heading).toHaveAttribute('id', 'missing-title');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('main')).toContainElement(heading);
    const badger = heading.querySelector('.page-heading__mascot');
    expect(badger).toHaveAttribute('aria-hidden', 'true');
    expect(badger?.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });

  it('starts every page with a skip link to the main content', async () => {
    renderApp('/');
    const skip = screen.getAllByRole('link')[0];
    expect(skip).toHaveTextContent('Skip to main content');
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(await screen.findByRole('link', { name: 'Org' })).toBeInTheDocument();
  });

  it('waits quietly for a route chunk, then focuses its heading after it arrives', async () => {
    render(
      <AuthContext.Provider value={fakeAuth()}>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
          <Link to="/organizations/o1/team">Open team</Link>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    await screen.findByRole('link', { name: 'Org' });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('link', { name: 'Open team' }));
      await act(async () => {});
      expect(screen.getByRole('main')).toHaveFocus();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(screen.getByRole('status')).toHaveTextContent('Loading.');
      await act(async () => teamImport.finish({ default: () => <h1 tabIndex={-1}>Deferred team</h1> }));
      expect(screen.getByRole('heading', { name: 'Deferred team' })).toHaveFocus();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('focuses the destination after leaving a missing route through the shell', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const expectedError = (event) => {
      if (event.error?.cause?.message === 'synthetic route unavailable') event.preventDefault();
    };
    window.addEventListener('error', expectedError);
    try {
      renderApp('/organizations/o1/applications/a1/accepted-agreement');
      await screen.findByRole('heading', { name: 'This page did not load' });
      fireEvent.click(screen.getByRole('link', { name: 'Event Runner' }));
      const heading = await screen.findByRole('heading', { level: 1, name: 'Your organizations' });
      expect(heading).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveFocus();
    } finally {
      cleanup();
      window.removeEventListener('error', expectedError);
      error.mockRestore();
    }
  });

  it('keeps focus on a control the reader chose while the destination data loads', async () => {
    let finishTeam;
    serveApi({
      listOrganizations: { operator: false, organizations: [{ id: 'o1', name: 'Org', role: 'owner' }] },
      listApplications: { applications: [] },
      getTeam: () => new Promise((resolve) => { finishTeam = resolve; }),
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Org' }));
    await screen.findByText('Loading the organization.');
    expect(screen.getByRole('main')).toHaveFocus();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    signOut.focus();
    await act(async () => finishTeam({ organization: { id: 'o1', name: 'Org' } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Org' })).toBeInTheDocument();
    expect(signOut).toHaveFocus();
  });

  it('sends a signed-out reader to sign in and remembers the page, invite token included', () => {
    renderApp('/invite/i1#token=abc', fakeAuth({ user: null }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Event Runner' })).toBeInTheDocument();
    expect(window.localStorage.getItem(RETURN_KEY)).toBe('/invite/i1#token=abc');
  });

  it('waits for the sign-in state before it decides', () => {
    renderApp('/', fakeAuth({ user: null, ready: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('asks a reader with an unconfirmed email to confirm it by an emailed link', async () => {
    const auth = renderApp('/', fakeAuth({ user: { uid: 'm', email: 'mo@example.org', emailVerified: false } }));
    expect(screen.getByText(/Send a sign-in link to/)).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(auth.sendEmailLink).toHaveBeenCalledWith('mo@example.org'));
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a sign-in link to mo@example.org.');
  });

  it('signs out from the header', async () => {
    const auth = renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  });

  it('saves a fresh keystroke before masthead sign-out and clears only that reader’s copies', async () => {
    const scope = { userId: 'ana', orgId: 'o1', appId: 'a1' };
    const other = { ...scope, userId: 'dee' };
    const old = { step: 'email', answers: { senderName: 'Kept email' } };
    keepAnswer(scope, old);
    keepAnswer(other, old);
    let finish;
    serveApi({ saveApplicationStep: (body) => new Promise((resolve) => {
      finish = () => resolve({ step: body.step, saved: true, errors: {} });
    }) });
    const auth = renderApp('/organizations/o1/applications/a1/organization');
    fireEvent.change(await screen.findByLabelText('Organization name'), { target: { value: 'New organization' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Organization name')).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(callApi.mock.calls.find(([name]) => name === 'saveApplicationStep')[1].answers.name).toBe('New organization');
    expect(readKeptAnswer(scope, 'email')).toBeNull();
    expect(readKeptAnswer(scope, 'organization')).toBeNull();
    expect(readKeptAnswer(other, 'email')).toEqual(old);
  });

  it('keeps the reader signed in with their copy when the pre-sign-out save fails', async () => {
    serveApi({ saveApplicationStep: () => { throw new Error('Offline'); } });
    const auth = renderApp('/organizations/o1/applications/a1/organization');
    fireEvent.change(await screen.findByLabelText('Organization name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Your answer was not saved. Save it before signing out.')).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(readKeptAnswer({ userId: 'ana', orgId: 'o1', appId: 'a1' }, 'organization').answers.name).toBe('Unsaved name');
  });

  it('allows explicit sign-out after a refused answer, including after moving to another step', async () => {
    serveApi({ saveApplicationStep: (body) => ({ step: body.step, saved: false, errors: { 'webAddress.name': 'That name is taken.' } }) });
    const auth = renderApp('/organizations/o1/applications/a1/web-address');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'taken-name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Your event' });
    const scope = { userId: 'ana', orgId: 'o1', appId: 'a1' };
    expect(readKeptAnswer(scope, 'webAddress')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    cleanup();
    expect(readKeptAnswer(scope, 'webAddress')).toBeNull();
  });

  it('forgets the saved page once a signed-in reader is past sign-in', async () => {
    window.localStorage.setItem(RETURN_KEY, '/organizations/o1');
    renderApp('/');
    await waitFor(() => expect(window.localStorage.getItem(RETURN_KEY)).toBeNull());
  });

  it('keeps the signup link while a reader confirms their email, and forgets it once they are back', async () => {
    window.localStorage.removeItem(RETURN_KEY);
    const unconfirmed = { uid: 'm', email: 'mo@example.org', emailVerified: false };
    const first = render(
      <AuthContext.Provider value={fakeAuth({ user: unconfirmed })}>
        <MemoryRouter initialEntries={['/start/l1#token=abc']}><AppRoutes /></MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByText(/Send a sign-in link to/)).toBeInTheDocument();
    expect(window.localStorage.getItem(RETURN_KEY)).toBe('/start/l1#token=abc');
    first.unmount();

    callApi.mockResolvedValueOnce({ organizationName: 'Org', status: 'open' });
    renderApp('/signin/finish');
    expect(await screen.findByRole('heading', { level: 1, name: 'Start your event site' })).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(RETURN_KEY)).toBeNull());
  });

  it('shows how to reach the hosting team only when an address is set', () => {
    renderApp('/nowhere');
    expect(screen.queryByText(/Need the hosting team/)).not.toBeInTheDocument();
    cleanup();
    vi.stubEnv('VITE_CONSOLE_HELP_EMAIL', 'help@example.org');
    renderApp('/nowhere');
    expect(screen.getByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org');
    cleanup();
    vi.stubEnv('VITE_CONSOLE_HELP_NAME', 'Sam Host');
    renderApp('/nowhere');
    expect(screen.getByText(/Need a hand\? Email Sam Host at/)).toBeInTheDocument();
    expect(hostName()).toBe('Sam Host');
    vi.unstubAllEnvs();
  });

  it('routes the review pages, and a client gets the hosting-team message', async () => {
    const notOperator = Object.assign(new Error('This page is for the hosting team.'), { code: 'not-operator' });
    for (const path of ['/review', '/review/settings', '/review/links', '/review/a1']) {
      callApi.mockRejectedValueOnce(notOperator);
      const { unmount } = render(
        <AuthContext.Provider value={fakeAuth()}>
          <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
        </AuthContext.Provider>,
      );
      expect(await screen.findByRole('heading', { level: 1, name: 'This page is for the hosting team' })).toBeInTheDocument();
      unmount();
    }
  });

  it('sends a signed-out reader to sign in and remembers the signup link, token included', () => {
    renderApp('/start/l1#token=abc', fakeAuth({ user: null }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Event Runner' })).toBeInTheDocument();
    expect(window.localStorage.getItem(RETURN_KEY)).toBe('/start/l1#token=abc');
  });

  it('has a page for an address it does not know', () => {
    renderApp('/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('routes the organization page, the setup steps and the status page', async () => {
    serveApi({ listApplications: { applications: [], myRole: 'owner', operator: false }, getTeam: team() });
    renderApp('/organizations/o1');
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local' })).toBeInTheDocument();
    cleanup();
    serveApi();
    renderApp('/organizations/o1/applications/a1/web-address');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your web address' })).toBeInTheDocument();
    cleanup();
    serveApi({ getApplication: { application: application({ status: 'approved', canEdit: false }) } });
    renderApp('/organizations/o1/applications/a1');
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local News Summit' })).toBeInTheDocument();
  });

  it('keeps the setup agreement step apart from the page that rereads an accepted agreement', async () => {
    serveApi({ getAgreement: { agreement: { version: 1, title: 'Test agreement', body: 'Test text.' }, accepted: null } });
    renderApp('/organizations/o1/applications/a1/agreement');
    expect(await screen.findByRole('heading', { level: 1, name: 'Agreement' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Test agreement' })).toBeInTheDocument();
    expect(screen.queryByText('Open your request to read and accept the agreement.')).not.toBeInTheDocument();
  });
});
