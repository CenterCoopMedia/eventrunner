// The browser half of the event data package (issue #329).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../contexts/AuthContext.jsx', () => ({
  functionsOrigin: () => 'https://fake-functions.example',
}));

const { downloadEventPackage, packageFilename, STOPPED_MESSAGE } = await import('./eventPackage.js');
const { AdminApiError } = await import('./adminApi.js');

describe('packageFilename', () => {
  it('reads the server’s name, and builds the same dated name when CORS hides the header', () => {
    expect(packageFilename('attachment; filename="event-data-package-2026-10-01.zip"')).toBe('event-data-package-2026-10-01.zip');
    expect(packageFilename(null, new Date('2026-10-02T09:00:00Z'))).toBe('event-data-package-2026-10-02.zip');
    expect(packageFilename('attachment; filename="../../x.zip"', new Date('2026-10-02T09:00:00Z'))).toBe('event-data-package-2026-10-02.zip');
  });
});

describe('downloadEventPackage', () => {
  let clicked;
  let originalCreate;
  let originalRevoke;

  beforeEach(() => {
    // The save revokes its object URL on the next tick; fake timers keep
    // that tick inside the test that made the URL.
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:package');
    URL.revokeObjectURL = vi.fn();
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicked.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  const getIdToken = async () => 'id-token';

  it('posts the choices with the bearer token and saves the zip under the server’s name', async () => {
    const blob = new Blob(['PK'], { type: 'application/zip' });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="event-data-package-2026-10-01.zip"' }),
      blob: async () => blob,
    });
    const result = await downloadEventPackage({ getIdToken, sections: ['program'], includeStaffNotes: false });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://fake-functions.example/downloadEventPackage');
    expect(init.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body)).toEqual({ sections: ['program'], includeStaffNotes: false });
    expect(clicked).toEqual([{ href: 'blob:package', download: 'event-data-package-2026-10-01.zip' }]);
    expect(result).toEqual({ filename: 'event-data-package-2026-10-01.zip', bytes: 2 });
  });

  it('turns a refusal into an AdminApiError with the server’s words, and saves nothing', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'This action needs operator access.' } }),
    });
    const error = await downloadEventPackage({ getIdToken, sections: ['program'], includeStaffNotes: false }).catch((err) => err);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe('This action needs operator access.');
    expect(clicked).toEqual([]);
  });

  it('saves nothing when the body stops part way, and says so', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), blob: async () => { throw new Error('reset'); } });
    await expect(downloadEventPackage({ getIdToken, sections: ['program'], includeStaffNotes: false }))
      .rejects.toMatchObject({ message: STOPPED_MESSAGE });
    expect(clicked).toEqual([]);
  });

  it('states a network failure and a lost session', async () => {
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(downloadEventPackage({ getIdToken, sections: ['program'], includeStaffNotes: false }))
      .rejects.toMatchObject({ code: 'network', status: 0 });
    await expect(downloadEventPackage({ getIdToken: () => Promise.reject(new Error('x')), sections: ['program'], includeStaffNotes: false }))
      .rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });
});
