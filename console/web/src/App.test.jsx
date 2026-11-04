import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { callApi } from './api.js';
import { AuthContext, RETURN_KEY } from './auth.jsx';
import { fakeAuth } from './test/renderPage.jsx';
import { AppRoutes } from './App.jsx';
import { application, serveApi, team } from './test/application.js';

vi.mock('./api.js', () => ({ callApi: vi.fn(async () => ({ operator: false, organizations: [{ id: 'o1', name: 'Org', role: 'owner' }] })) }));

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
  it('starts every page with a skip link to the main content', async () => {
    renderApp('/');
    const skip = screen.getAllByRole('link')[0];
    expect(skip).toHaveTextContent('Skip to main content');
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(await screen.findByRole('link', { name: 'Org' })).toBeInTheDocument();
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
    expect(screen.getByText(/We could not confirm your email address/)).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    await waitFor(() => expect(auth.sendEmailLink).toHaveBeenCalledWith('mo@example.org'));
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a sign-in link to mo@example.org.');
  });

  it('signs out from the header', async () => {
    const auth = renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
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
    expect(screen.getByText(/We could not confirm your email address/)).toBeInTheDocument();
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
});
