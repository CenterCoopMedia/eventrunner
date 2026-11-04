import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { AuthContext } from '../auth.jsx';

/** A signed-in user with a verified email, as AuthContext gives it. */
export function signedInUser(overrides = {}) {
  return { uid: 'ana', email: 'ana@example.org', emailVerified: true, ...overrides };
}

/** An AuthContext value with every method as a mock. */
export function fakeAuth(overrides = {}) {
  return {
    user: signedInUser(),
    ready: true,
    signInWithGoogle: vi.fn(async () => {}),
    signInWithMicrosoft: vi.fn(async () => {}),
    sendEmailLink: vi.fn(async () => {}),
    isEmailLink: vi.fn(() => false),
    finishEmailLink: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

/**
 * Render `element` at `path` inside a router and an AuthContext. `routes`
 * adds stand-in pages, so a test can see where a page sends the reader.
 */
export function renderPage(element, { path = '/', route = '*', auth = fakeAuth(), routes = {} } = {}) {
  const utils = render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
          {Object.entries(routes).map(([p, text]) => (
            <Route key={p} path={p} element={<p>{text}</p>} />
          ))}
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { ...utils, auth };
}
