import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ToastContext from '../contexts/ToastContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import Login from './Login.jsx';

const demo = vi.hoisted(() => ({ staticDemo: false }));
vi.mock('../lib/demoMode.js', () => ({ get IS_DEMO() { return demo.staticDemo; } }));

const signInWithGoogle = vi.fn();
const sendOtpCode = vi.fn();
const verifyOtpCode = vi.fn();
const signOut = vi.fn();

function renderSignIn({ eventConfig = {}, user = null, loading = false, panel = false, from = null } = {}) {
  const entry = from ? { pathname: '/signin', state: { from } } : '/signin';
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EventConfigContext.Provider value={{ eventConfig }}>
        <AuthContext.Provider value={{ user, loading, signInWithGoogle, sendOtpCode, verifyOtpCode, signOut }}>
          <ToastContext.Provider value={{ showToast: vi.fn() }}>
            <Routes><Route path="/signin" element={panel ? <SignInPanel /> : <Login />} /></Routes>
          </ToastContext.Provider>
        </AuthContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  demo.staticDemo = false;
  vi.clearAllMocks();
});

function expectDisabled() {
  expect(screen.getByText('Sign-in is disabled in this demo')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText(/one-time code by email/)).not.toBeInTheDocument();
  for (const action of [signInWithGoogle, sendOtpCode, verifyOtpCode, signOut]) {
    expect(action).not.toHaveBeenCalled();
  }
}

describe('/signin read-only demo gate', () => {
  it('shows the notice on a deployed historical demo in a normal build', () => {
    renderSignIn({ eventConfig: { historicalDemo: true } });
    expectDisabled();
  });

  it.each([
    { loading: true },
    { user: { uid: 'saved-account', email: 'account@example.test' } },
  ])('gates historical demos before auth state branches: %j', (auth) => {
    renderSignIn({ eventConfig: { historicalDemo: true }, ...auth });
    expectDisabled();
  });

  it('also gates the shared panel outside the sign-in page', () => {
    renderSignIn({ eventConfig: { historicalDemo: true }, panel: true });
    expectDisabled();
  });

  it('keeps the static demo disabled without deployed configuration', () => {
    demo.staticDemo = true;
    renderSignIn();
    expectDisabled();
  });

  it('opens Google sign-in when the admin CMS sent the visitor here', () => {
    renderSignIn({ eventConfig: { historicalDemo: true }, from: '/admin/pages' });
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByText(/does not send email codes/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign-in is disabled in this demo')).not.toBeInTheDocument();
  });

  it.each(['https://evil.test/admin', '//admin', '/administrator', '/signin'])(
    'keeps the notice for a return path outside the admin CMS: %s',
    (from) => {
      renderSignIn({ eventConfig: { historicalDemo: true }, from });
      expectDisabled();
    },
  );

  it.each([{}, { historicalDemo: false }])('keeps normal client sign-in available: %j', (eventConfig) => {
    renderSignIn({ eventConfig });
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    expect(screen.queryByText('Sign-in is disabled in this demo')).not.toBeInTheDocument();
  });
});
