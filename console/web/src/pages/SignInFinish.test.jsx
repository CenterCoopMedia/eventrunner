import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMAIL_KEY, RETURN_KEY } from '../auth.jsx';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
import SignInFinish from './SignInFinish.jsx';

const linkAuth = (overrides) => fakeAuth({ user: null, isEmailLink: vi.fn(() => true), ...overrides });

describe('SignInFinish', () => {
  it('finishes the sign-in with the remembered address', async () => {
    window.localStorage.setItem(EMAIL_KEY, 'sam@example.org');
    const auth = linkAuth();
    renderPage(<SignInFinish />, { path: '/signin/finish', auth });
    await waitFor(() => expect(auth.finishEmailLink).toHaveBeenCalledWith('sam@example.org', window.location.href));
  });

  it('asks for the address when the link opens in another browser', async () => {
    const auth = linkAuth();
    renderPage(<SignInFinish />, { path: '/signin/finish', auth });
    expect(screen.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'sam@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(auth.finishEmailLink).toHaveBeenCalledWith('sam@example.org', window.location.href));
  });

  it('says when the link has expired, with a way to get a new one', async () => {
    window.localStorage.setItem(EMAIL_KEY, 'sam@example.org');
    const auth = linkAuth({
      finishEmailLink: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'auth/invalid-action-code' }); }),
    });
    renderPage(<SignInFinish />, { path: '/signin/finish', auth });
    expect(await screen.findByRole('alert')).toHaveTextContent('This sign-in link has expired or was already used.');
    expect(screen.getByRole('link', { name: 'Get a new sign-in link' })).toHaveAttribute('href', '/signin');
  });

  it('sends a page that is not a sign-in link to the sign-in page', () => {
    renderPage(<SignInFinish />, { path: '/signin/finish', auth: fakeAuth({ user: null }), routes: { '/signin': 'Sign-in page' } });
    expect(screen.getByText('Sign-in page')).toBeInTheDocument();
  });

  it('sends a signed-in reader on', () => {
    renderPage(<SignInFinish />, { path: '/signin/finish', routes: { '/': 'Home page' } });
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });

  it('returns to the signup link from the link itself when another tab already cleared the saved path', () => {
    window.localStorage.removeItem(RETURN_KEY);
    window.history.replaceState(null, '', '/signin/finish?next=%2Fstart%2Fabc&oobCode=1');
    const auth = linkAuth({ user: { uid: 'u1', email: 'sam@example.org', emailVerified: true } });
    renderPage(<SignInFinish />, { path: '/signin/finish', auth, routes: { '/start/abc': 'Start page', '/': 'Home page' } });
    expect(screen.getByText('Start page')).toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('uses the link even when an unconfirmed session is already open in this browser', async () => {
    window.localStorage.removeItem(EMAIL_KEY);
    const auth = linkAuth({ user: { uid: 'u1', email: 'sam@example.org', emailVerified: false } });
    renderPage(<SignInFinish />, { path: '/signin/finish', auth, routes: { '/': 'Home page' } });
    await waitFor(() => expect(auth.finishEmailLink).toHaveBeenCalledWith('sam@example.org', window.location.href));
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });

  it('sends a confirmed reader on without spending the link', () => {
    const auth = linkAuth({ user: { uid: 'u1', email: 'sam@example.org', emailVerified: true } });
    renderPage(<SignInFinish />, { path: '/signin/finish', auth, routes: { '/': 'Home page' } });
    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(auth.finishEmailLink).not.toHaveBeenCalled();
  });
});
