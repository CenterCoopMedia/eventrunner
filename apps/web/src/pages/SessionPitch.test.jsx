// The /pitch page in its two intake modes: this site's own form, or a link
// to an external form (for example, Airtable) that replaces it for the call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

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

const FORM = 'https://airtable.com/appExample/shrExample';
const OPEN_UNTIL = '2999-01-31T23:59:59Z';

beforeEach(() => {
  user = null;
  call.mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

describe('SessionPitch with an external form', () => {
  it('links to the external form while the call is open and hides this site’s form', () => {
    pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl: FORM };
    render(<SessionPitch />);
    expect(screen.getByRole('status')).toHaveTextContent('Submissions are open');
    const link = screen.getByRole('link', { name: /Open the pitch form/ });
    expect(link).toHaveAttribute('href', FORM);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(screen.queryByLabelText(/Session title/)).toBeNull();
    expect(screen.queryByText('Sign-in panel')).toBeNull();
    expect(screen.queryByText(/verified email address is required/)).toBeNull();
  });

  it('shows no link once the call is closed', () => {
    for (const value of [
      { enabled: false, closesAt: OPEN_UNTIL, externalFormUrl: FORM },
      { enabled: true, closesAt: '2000-01-01T00:00:00Z', externalFormUrl: FORM },
    ]) {
      pitchCall = value;
      render(<SessionPitch />);
      expect(screen.getByRole('status')).toHaveTextContent('Submissions are closed');
      expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
      expect(screen.getByText('The pitch form is not available now.')).toBeInTheDocument();
      cleanup();
    }
  });

  it('never links to an address the server would refuse', () => {
    for (const externalFormUrl of ['http://airtable.com/shr', 'javascript:alert(1)']) {
      pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl };
      render(<SessionPitch />);
      expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
      expect(screen.getByLabelText(/Session title/)).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('SessionPitch before the call is known', () => {
  it('shows neither form while the first snapshot loads', () => {
    pitchCall = undefined;
    render(<SessionPitch />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking submissions…');
    expect(screen.queryByLabelText(/Session title/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
  });

  it('keeps the external form mode through a read error', () => {
    pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl: FORM };
    render(<SessionPitch />);
    act(() => listener.onError(new Error('offline')));
    expect(screen.getByRole('status')).toHaveTextContent('Cannot check submissions. Reconnecting…');
    expect(screen.queryByLabelText(/Session title/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
    expect(screen.getByText('The pitch form is not available now.')).toBeInTheDocument();
  });
});

describe('SessionPitch with this site’s form', () => {
  it('keeps the native form and sign-in when no external form is set', () => {
    pitchCall = { enabled: true, closesAt: OPEN_UNTIL, externalFormUrl: null };
    render(<SessionPitch />);
    expect(screen.getByLabelText(/Session title/)).toBeInTheDocument();
    expect(screen.getByText('Sign-in panel')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open the pitch form/ })).toBeNull();
  });
});
