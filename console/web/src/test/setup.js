import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Tests run with no credentials and no network. Pages read the signed-in
// user and the sign-in methods from AuthContext (test/renderPage.jsx), and
// the server through api.js, which each test mocks. The Firebase entry
// module is mocked here so no test can start the SDK by accident.
vi.mock('../firebase.js', () => ({ app: {}, auth: {} }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // Storage can be missing; nothing to clear then.
  }
});
