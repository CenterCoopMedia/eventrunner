import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RETURN_KEY } from '../auth.jsx';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
import SignIn from './SignIn.jsx';

const signedOut = (overrides) => fakeAuth({ user: null, ...overrides });

describe('SignIn', () => {
  it('offers Google, Microsoft and an emailed link, in plain words', () => {
    renderPage(<SignIn />, { path: '/signin', auth: signedOut() });
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Event Runner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'email');
    expect(document.body.textContent).not.toMatch(/firebase|project|tenant/i);
  });

  it('offers only the emailed link when no other sign-in method is set up', () => {
    vi.stubEnv('VITE_CONSOLE_SIGN_IN_PROVIDERS', '');
    renderPage(<SignIn />, { path: '/signin', auth: signedOut() });
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Use email' })).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('signs in with Microsoft', async () => {
    const auth = signedOut();
    renderPage(<SignIn />, { path: '/signin', auth });
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Microsoft' }));
    await waitFor(() => expect(auth.signInWithMicrosoft).toHaveBeenCalled());
  });

  it('sends a link and says where it went', async () => {
    const auth = signedOut();
    renderPage(<SignIn />, { path: '/signin', auth });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'sam@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a sign-in link to sam@example.org.');
    expect(auth.sendEmailLink).toHaveBeenCalledWith('sam@example.org');
    const edit = screen.getByRole('button', { name: 'Use another email address' });
    expect(edit).toHaveAttribute('title', 'Use another email address');
    fireEvent.click(edit);
    await waitFor(() => expect(screen.getByLabelText('Email address')).toHaveFocus());
    expect(screen.getByLabelText('Email address')).toHaveValue('sam@example.org');
  });

  it('checks the address on submit, marks the field and moves focus to it', async () => {
    const auth = signedOut();
    renderPage(<SignIn />, { path: '/signin', auth });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    const field = screen.getByLabelText('Email address');
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(auth.sendEmailLink).not.toHaveBeenCalled();
  });

  it('shows a plain error when sign-in fails', async () => {
    const auth = signedOut({
      signInWithGoogle: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'auth/popup-blocked' }); }),
    });
    renderPage(<SignIn />, { path: '/signin', auth });
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your browser blocked the sign-in window.');
  });

  it('sends a signed-in reader on to the saved page', () => {
    window.localStorage.setItem(RETURN_KEY, '/invite/i1#token=abc');
    renderPage(<SignIn />, { path: '/signin', routes: { '/invite/:id': 'Invite page' } });
    expect(screen.getByText('Invite page')).toBeInTheDocument();
  });
});
