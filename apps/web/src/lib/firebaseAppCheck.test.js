import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.unmock('../firebase.js');
vi.unmock('./firebaseSettings.js');
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}) }));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }));

class ReCaptchaEnterpriseProvider {
  constructor(siteKey) {
    this.siteKey = siteKey;
  }
}

const appCheck = {};
const initializeAppCheck = vi.fn(() => appCheck);
const getToken = vi.fn(async () => ({ token: 'fixture-attestation' }));
const loadAppCheck = vi.fn(() => ({ initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_DEMO_MODE', '');
  vi.stubEnv('VITE_USE_EMULATORS', '');
  vi.doMock('firebase/app-check', loadAppCheck);
});

afterEach(() => vi.unstubAllEnvs());

it('uses the Enterprise key to attest requests and refreshes tokens automatically', async () => {
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'fixture-site-key');
  const { app, appCheckHeaders } = await import('../firebase.js');

  await expect(appCheckHeaders()).resolves.toEqual({ 'X-Firebase-AppCheck': 'fixture-attestation' });
  expect(initializeAppCheck).toHaveBeenCalledWith(app, {
    provider: new ReCaptchaEnterpriseProvider('fixture-site-key'),
    isTokenAutoRefreshEnabled: true,
  });
  expect(getToken).toHaveBeenCalledWith(appCheck, false);
});

it('leaves requests unattested and skips the App Check SDK when the site key is absent', async () => {
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', '');
  const { appCheckHeaders } = await import('../firebase.js');

  await expect(appCheckHeaders()).resolves.toEqual({});
  expect(loadAppCheck).not.toHaveBeenCalled();
});
